const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
moment.locale('pt-br');

const https = require('https');
const express = require('express');
const app = express();

const token = process.env.BOT_TOKEN;
const isProduction = process.env.NODE_ENV === 'production';

const bot = new TelegramBot(token, { polling: !isProduction });

if (isProduction) {
    const url = process.env.RENDER_EXTERNAL_URL;
    if (!url) {
        throw new Error('RENDER_EXTERNAL_URL não está definida nas variáveis de ambiente!');
    }
    bot.setWebHook(`${url}/bot${token}`);
    app.use(express.json());
    app.post(`/bot${token}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Servidor webhook rodando na porta ${PORT}`);
    });
} else {
    console.log('Bot rodando em modo Polling local...');
}

let state = {
  saldo: 0,
  gastos: [],
  despesasFixas: [],
  entradas: []
};
let userState = {};

const menuPrincipal = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '➕ Incluir saldo', callback_data: 'action_add_saldo' }, { text: '➕ Incluir despesa', callback_data: 'action_add_despesa' }],
      [{ text: '💸 Gasto dinheiro/débito', callback_data: 'gasto_dinheiro' }, { text: '💳 Gasto cartão', callback_data: 'gasto_cartao' }],
      [{ text: '🍽️ Gasto SODEXO', callback_data: 'gasto_sodexo' }, { text: '📋 Listar gastos', callback_data: 'list_gastos' }],
      [{ text: '📑 Listar despesas', callback_data: 'list_despesas' }, { text: '💸 Pagar despesa', callback_data: 'pay_despesa' }],
      [{ text: '📊 Resumo do Mês', callback_data: 'show_summary' }, { text: '💰 Listar Entradas', callback_data: 'list_entradas' }]
    ]
  }
};

const backButton = {
  reply_markup: {
    inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'main_menu' }]]
  }
};

function getResumoText(gastosPeriodo, titulo) {
    const totalDinheiro = gastosPeriodo.filter(g => g.tipo === 'dinheiro').reduce((acc, g) => acc + g.valor, 0);
    const totalCartao = gastosPeriodo.filter(g => g.tipo === 'cartao').reduce((acc, g) => acc + g.valor, 0);
    const totalSodexo = gastosPeriodo.filter(g => g.tipo === 'sodexo').reduce((acc, g) => acc + g.valor, 0);
    
    let totalDespesasPagas = 0;
    if (titulo.toLowerCase().includes("resumo de")) {
        const mesReferencia = gastosPeriodo.length > 0 ? moment(gastosPeriodo[0].data) : moment();
        totalDespesasPagas = state.despesasFixas
            .filter(d => d.status === 'pago' && d.dataPagamento && moment(d.dataPagamento).isSame(mesReferencia, 'month'))
            .reduce((acc, d) => acc + d.valor, 0);
    }
    
    const saldoDisponivel = state.saldo - totalDinheiro - totalDespesasPagas;

    return `*${titulo}*\n\n` +
        (titulo.toLowerCase().includes("resumo de") ? `💰 *Saldo disponível:* R$ ${saldoDisponivel.toFixed(2)}\n` : '') +
        `💸 *Gastos Dinheiro/Débito:* R$ ${totalDinheiro.toFixed(2)}\n` +
        `💳 *Fatura Cartão:* R$ ${totalCartao.toFixed(2)}\n` +
        `🍽️ *Gastos SODEXO:* R$ ${totalSodexo.toFixed(2)}\n` +
        (totalDespesasPagas > 0 ? `🧾 *Despesas Pagas:* R$ ${totalDespesasPagas.toFixed(2)}\n` : '');
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Bem-vindo ao bot de orçamento!', menuPrincipal);
});

// ####################################################################
// ### CORREÇÃO PRINCIPAL ESTÁ AQUI DENTRO ###
// ####################################################################
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    const currentState = userState[chatId];
    if (!currentState) return;

    const { action, type } = currentState;
    let success = false;
    let successMessage = '';

    try { // <-- INÍCIO DO BLOCO DE SEGURANÇA
        if (action === 'awaiting_saldo') {
            const partes = text.split(',');
            if (partes.length < 2) {
                bot.sendMessage(chatId, '❌ Formato inválido. Use: `descrição, valor`');
            } else {
                const descricao = partes[0]?.trim();
                const valorStr = partes[1]?.trim().replace(',', '.'); // Aceita vírgula e ponto
                const valor = parseFloat(valorStr);
                
                if (descricao && !isNaN(valor)) {
                    state.saldo += valor;
                    state.entradas.push({ id: Date.now(), descricao, valor, data: moment().format() });
                    successMessage = `✅ Saldo de R$ ${valor.toFixed(2)} adicionado referente a "${descricao}"!`;
                    success = true;
                } else {
                    bot.sendMessage(chatId, '❌ Formato inválido. Use: `descrição, valor`\n*Exemplo:* `Salário, 3400`');
                }
            }
        }

        if (action === 'awaiting_despesa') {
            const partes = text.split(',');
            if (partes.length < 2) {
                bot.sendMessage(chatId, '❌ Formato inválido. Use: `descrição, valor`');
            } else {
                const descricao = partes[0]?.trim();
                const valorStr = partes[1]?.trim().replace(',', '.');
                const valor = parseFloat(valorStr);
                if (descricao && !isNaN(valor)) {
                    state.despesasFixas.push({ id: Date.now(), descricao, valor, status: 'pendente' });
                    successMessage = `✅ Despesa "${descricao}" adicionada.`;
                    success = true;
                } else {
                    bot.sendMessage(chatId, '❌ Formato inválido. Use: `descrição, valor`');
                }
            }
        }

        if (action === 'awaiting_gasto') {
            const linhas = text.split('\n');
            let successCount = 0;
            let errorLines = [];

            linhas.forEach((linha, index) => {
                if (!linha.trim()) return; // Ignora linhas vazias

                const partes = linha.split(',');
                if (partes.length < 2) {
                    errorLines.push(index + 1);
                    return;
                }

                const descricao = partes[0]?.trim();
                const valorStr = partes[1]?.trim().replace(',', '.');
                const valor = parseFloat(valorStr);
                const dataStr = partes[2]?.trim();
                const dataInformada = dataStr ? moment(dataStr, 'DD/MM', true) : moment();

                if (descricao && !isNaN(valor) && dataInformada.isValid()) {
                    state.gastos.push({ id: Date.now(), descricao, valor, tipo, data: dataInformada.format() });
                    successCount++;
                } else {
                    errorLines.push(index + 1);
                }
            });

            if (successCount > 0) {
                successMessage = `✅ ${successCount} gasto(s) adicionado(s)!`;
                success = true;
            }
            if (errorLines.length > 0) {
                bot.sendMessage(chatId, `❌ As linhas a seguir não puderam ser processadas por erro de formato: ${errorLines.join(', ')}`);
            }
            if(successCount === 0 && errorLines.length > 0) {
                success = false; // Não mostra resumo se tudo deu erro
            }
        }

    } catch (error) {
        console.error("ERRO CRÍTICO NO PROCESSAMENTO DE MENSAGEM:", error);
        bot.sendMessage(chatId, "🚨 Ocorreu um erro inesperado. O bot não travou, mas sua última ação pode não ter sido concluída. Tente novamente.");
    } // <-- FIM DO BLOCO DE SEGURANÇA

    if (success) {
        bot.sendMessage(chatId, successMessage);
        const gastosDoMes = state.gastos.filter(g => moment(g.data).isSame(moment(), 'month'));
        bot.sendMessage(chatId, getResumoText(gastosDoMes, `Resumo de ${moment().format('MMMM')}`), { ...backButton, parse_mode: 'Markdown' });
    }
    
    delete userState[chatId];
});

// O restante do código (callback_query, /start, etc.) permanece o mesmo.
// ...
