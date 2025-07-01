const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
moment.locale('pt-br');

const https = require('https');
const express = require('express');
const app = express();

const token = process.env.BOT_TOKEN;
// Para deploy no Render, use Webhook. Para testar local, use polling.
// Lembre-se de parar a execução local (Ctrl+C) antes de fazer deploy.
const isProduction = process.env.NODE_ENV === 'production';

const bot = new TelegramBot(token, { polling: !isProduction });

if (isProduction) {
    const url = process.env.RENDER_EXTERNAL_URL;
    if (!url) {
        throw new Error('RENDER_EXTERNAL_URL não está definida!');
    }
    bot.setWebHook(`${url}/bot${token}`);
    app.use(express.json());
    app.post(`/bot${token}`, (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Servidor rodando em modo Webhook na porta ${PORT}`);
    });
} else {
    console.log('Bot rodando em modo Polling para desenvolvimento local...');
}


// Objeto de estado centralizado
let state = {
  saldo: 0,
  gastos: [],
  despesasFixas: []
};

// Gerenciador de estado da conversa
let userState = {};

// --- MENUS E INTERFACE ---
const menuPrincipal = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '➕ Incluir saldo', callback_data: 'action_add_saldo' }, { text: '➕ Incluir despesa', callback_data: 'action_add_despesa' }],
      [{ text: '💸 Gasto dinheiro/débito', callback_data: 'gasto_dinheiro' }, { text: '💳 Gasto cartão', callback_data: 'gasto_cartao' }],
      [{ text: '🍽️ Gasto SODEXO', callback_data: 'gasto_sodexo' }, { text: '📋 Listar gastos', callback_data: 'list_gastos' }],
      [{ text: '📑 Listar despesas', callback_data: 'list_despesas' }, { text: '💸 Pagar despesa', callback_data: 'pay_despesa' }],
      [{ text: '📊 Resumo do Mês', callback_data: 'show_summary' }]
    ]
  }
};

const backButton = {
  reply_markup: {
    inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'main_menu' }]]
  }
};

// --- FUNÇÕES AUXILIARES ---
function getResumoText(gastosPeriodo, titulo) {
    const totalDinheiro = gastosPeriodo.filter(g => g.tipo === 'dinheiro').reduce((acc, g) => acc + g.valor, 0);
    const totalCartao = gastosPeriodo.filter(g => g.tipo === 'cartao').reduce((acc, g) => acc + g.valor, 0);
    const totalSodexo = gastosPeriodo.filter(g => g.tipo === 'sodexo').reduce((acc, g) => acc + g.valor, 0);
    
    // Para o resumo geral, consideramos despesas pagas. Para resumos de itens, não.
    const totalDespesasPagas = titulo.toLowerCase().includes("resumo de") 
        ? state.despesasFixas.filter(d => d.status === 'pago' && moment(d.dataPagamento).isSame(moment(gastosPeriodo[0]?.data), 'month')).reduce((acc, d) => acc + d.valor, 0)
        : 0;

    const saldoAtual = state.saldo - totalDinheiro - totalDespesasPagas;

    return `*${titulo}*\n\n` +
        (titulo.toLowerCase().includes("resumo de") ? `💰 *Saldo disponível:* R$ ${saldoAtual.toFixed(2)}\n` : '') +
        `💸 *Gastos Dinheiro/Débito:* R$ ${totalDinheiro.toFixed(2)}\n` +
        `💳 *Fatura Cartão:* R$ ${totalCartao.toFixed(2)}\n` +
        `🍽️ *Gastos SODEXO:* R$ ${totalSodexo.toFixed(2)}\n` +
        (totalDespesasPagas > 0 ? `🧾 *Despesas Pagas:* R$ ${totalDespesasPagas.toFixed(2)}\n` : '');
}

// --- HANDLERS DO BOT ---
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Bem-vindo ao bot de orçamento!', menuPrincipal);
});

// Handler principal para mensagens de texto (respostas do usuário)
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    const currentState = userState[chatId];
    if (!currentState) return;

    const { action, type } = currentState;
    let success = false;

    if (action === 'awaiting_gasto') {
        const linhas = text.split('\n');
        let successCount = 0;
        linhas.forEach(linha => {
            const partes = linha.split(',');
            const descricao = partes[0]?.trim();
            const valor = parseFloat(partes[1]);
            // NOVA LÓGICA DE DATA: Aceita DD/MM para lançamentos retroativos
            const dataInformada = partes[2] ? moment(partes[2].trim(), 'DD/MM', true) : moment();

            if (descricao && !isNaN(valor) && dataInformada.isValid()) {
                // Adiciona a data de lançamento automaticamente
                state.gastos.push({ id: Date.now(), descricao, valor, tipo, data: dataInformada.format() });
                successCount++;
            }
        });
        if (successCount > 0) {
            bot.sendMessage(chatId, `✅ ${successCount} gasto(s) adicionado(s)!`);
            success = true;
        } else {
            bot.sendMessage(chatId, '❌ Nenhum gasto adicionado. Verifique o formato.');
        }
    }
    
    // Lógica para outros inputs (saldo, despesa)
    // ...

    if (success) {
        const gastosDoMes = state.gastos.filter(g => moment(g.data).isSame(moment(), 'month'));
        bot.sendMessage(chatId, getResumoText(gastosDoMes, `Resumo de ${moment().format('MMMM')}`), { ...backButton, parse_mode: 'Markdown' });
    }
    
    delete userState[chatId];
});

// Handler para os botões
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    if (data.startsWith('gasto_')) {
        const tipo = data.replace('gasto_', '');
        userState[chatId] = { action: 'awaiting_gasto', type: tipo };
        // Mensagem mais clara sobre a data retroativa
        bot.editMessageText(
            `Envie o gasto no formato:\n\`descrição, valor, data (opcional)\`\n\n*Exemplo retroativo:*\n\`Uber, 25, 15/07\``,
            { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
        return;
    }

    if (data === 'show_summary') {
        const gastosDoMes = state.gastos.filter(g => moment(g.data).isSame(moment(), 'month'));
        bot.editMessageText(getResumoText(gastosDoMes, `Resumo de ${moment().format('MMMM')}`), { chat_id: chatId, message_id: messageId, ...backButton, parse_mode: 'Markdown' });
    }
    
    // ... (restante da lógica dos botões: main_menu, list_gastos, etc.)
    bot.answerCallbackQuery(query.id).catch(() => {});
});


// --- NOVOS COMANDOS ---

// 1. Comando de Resumo Aprimorado
bot.onText(/\/resumo\s*(.*)/, (msg, match) => {
    const chatId = msg.chat.id;
    const termo = match[1].trim().toLowerCase();

    // Se não houver termo, mostra o resumo do mês atual
    if (!termo) {
        const gastosDoMes = state.gastos.filter(g => moment(g.data).isSame(moment(), 'month'));
        if (gastosDoMes.length === 0) {
            bot.sendMessage(chatId, `Nenhum gasto registrado em ${moment().format('MMMM')}.`);
            return;
        }
        bot.sendMessage(chatId, getResumoText(gastosDoMes, `Resumo de ${moment().format('MMMM')}`), { parse_mode: 'Markdown' });
        return;
    }

    // 2. Verifica se o termo é um nome de mês
    const meses = moment.months();
    const mesIndex = meses.findIndex(m => m.toLowerCase() === termo);

    if (mesIndex > -1) {
        // Filtra os gastos para aquele mês do ano corrente
        const gastosDoMes = state.gastos.filter(g => moment(g.data).month() === mesIndex);
        if (gastosDoMes.length === 0) {
            bot.sendMessage(chatId, `Nenhum gasto encontrado para o mês de ${termo}.`);
            return;
        }
        const titulo = `Resumo de ${termo.charAt(0).toUpperCase() + termo.slice(1)}`;
        bot.sendMessage(chatId, getResumoText(gastosDoMes, titulo), { parse_mode: 'Markdown' });
        return;
    }

    // 3. Se não for mês, trata como filtro de item/categoria para o mês ATUAL
    const gastosFiltrados = state.gastos.filter(g =>
        g.descricao.toLowerCase().includes(termo) &&
        moment(g.data).isSame(moment(), 'month')
    );

    if (gastosFiltrados.length === 0) {
        bot.sendMessage(chatId, `Nenhum gasto com "${termo}" encontrado neste mês.`);
        return;
    }

    const total = gastosFiltrados.reduce((acc, g) => acc + g.valor, 0);
    // Adiciona a data de cada lançamento no detalhamento
    const lista = gastosFiltrados.map(g =>
        `*${moment(g.data).format('DD/MM')}* - ${g.descricao} - R$ ${g.valor.toFixed(2)} (${g.tipo})`
    ).join('\n');

    const mensagem = `*Gastos com "${termo}" em ${moment().format('MMMM')}*:\n\n${lista}\n\n*Total:* R$ ${total.toFixed(2)}`;
    bot.sendMessage(chatId, mensagem, { parse_mode: 'Markdown' });
});


// --- EXPORTAR E IMPORTAR (FUNCIONANDO EM MEMÓRIA) ---
// ... (código de exportar e importar permanece o mesmo)

console.log('Bot em execução com novas funcionalidades de resumo e data...');
