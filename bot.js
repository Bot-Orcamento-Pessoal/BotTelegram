const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
moment.locale('pt-br');

const https = require('https');
const fs = require('fs');
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

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    const currentState = userState[chatId];
    if (!currentState) return;

    const { action, type } = currentState;
    let success = false;
    let successMessage = '';

    if (action === 'awaiting_saldo') {
        const partes = text.split(',');
        if (partes.length < 2) {
            bot.sendMessage(chatId, '❌ Formato inválido. Use: `descrição, valor`');
        } else {
            const descricao = partes[0]?.trim();
            const valorStr = partes[1]?.trim().replace(',', '.');
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
    } else if (action === 'awaiting_despesa') {
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
    } else if (action === 'awaiting_gasto') {
        const linhas = text.split('\n');
        let successCount = 0;
        let errorLines = [];

        linhas.forEach((linha, index) => {
            if (!linha.trim()) return;

            try {
                const partes = linha.split(',');
                if (partes.length < 2) { throw new Error("Formato inválido, faltam partes."); }

                const descricao = partes[0]?.trim();
                const valorStr = partes[1]?.trim().replace(',', '.');
                const valor = parseFloat(valorStr);
                const dataStr = partes[2]?.trim();
                const dataInformada = dataStr ? moment(dataStr, 'DD/MM', true) : moment();

                if (descricao && !isNaN(valor) && dataInformada.isValid()) {
                    state.gastos.push({ id: Date.now(), descricao, valor, tipo: type, data: dataInformada.format() });
                    successCount++;
                } else {
                    throw new Error("Dados inválidos (descrição, valor ou data).");
                }
            } catch (error) {
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
            success = false;
        }
    }

    if (success) {
        bot.sendMessage(chatId, successMessage);
        const gastosDoMes = state.gastos.filter(g => moment(g.data).isSame(moment(), 'month'));
        bot.sendMessage(chatId, getResumoText(gastosDoMes, `Resumo de ${moment().format('MMMM')}`), { ...backButton, parse_mode: 'Markdown' });
    }
    
    delete userState[chatId];
});

bot.on('callback_query', (query) => {
    bot.answerCallbackQuery(query.id).catch(() => {});

    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    const inputActions = {
        'action_add_saldo': { state: 'awaiting_saldo', text: 'Envie o saldo no formato: `descrição, valor`\n\n*Exemplo:* `Salário Júnior, 3400`' },
        'action_add_despesa': { state: 'awaiting_despesa', text: 'Envie a despesa no formato: `descrição, valor`' },
        'gasto_dinheiro': { state: 'awaiting_gasto', type: 'dinheiro', text: 'Envie o(s) gasto(s) em dinheiro/débito:\n`descrição, valor, data (opcional)`\n\n*Exemplo:* `Almoço, 25, 20/07`' },
        'gasto_cartao': { state: 'awaiting_gasto', type: 'cartao', text: 'Envie o(s) gasto(s) no cartão:\n`descrição, valor, data (opcional)`' },
        'gasto_sodexo': { state: 'awaiting_gasto', type: 'sodexo', text: 'Envie o(s) gasto(s) no Sodexo:\n`descrição, valor, data (opcional)`' }
    };

    if (inputActions[data]) {
        const { state: action, type, text } = inputActions[data];
        userState[chatId] = { action, type };
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        return;
    }
    
    if (data === 'main_menu') {
        bot.editMessageText('Menu principal:', { chat_id: chatId, message_id: messageId, ...menuPrincipal });
    }

    if (data === 'show_summary') {
        const gastosDoMes = state.gastos.filter(g => moment(g.data).isSame(moment(), 'month'));
        bot.editMessageText(getResumoText(gastosDoMes, `Resumo de ${moment().format('MMMM')}`), { chat_id: chatId, message_id: messageId, ...backButton, parse_mode: 'Markdown' });
    }

    if (data === 'list_gastos') {
        let text = '*Lista de Gastos:*\n\n';
        if (state.gastos.length === 0) {
            text = 'Nenhum gasto registrado.';
        } else {
            text += state.gastos
                .sort((a, b) => moment(b.data).diff(moment(a.data)))
                .map(g => `*${moment(g.data).format('DD/MM')}* - ${g.descricao} - R$ ${g.valor.toFixed(2)} (${g.tipo})`)
                .join('\n');
        }
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...backButton, parse_mode: 'Markdown' });
    }

    if (data === 'list_entradas') {
        let text = '*Histórico de Entradas de Saldo:*\n\n';
        if (state.entradas.length === 0) {
            text = 'Nenhuma entrada de saldo registrada.';
        } else {
            text += state.entradas
                .sort((a, b) => moment(b.data).diff(moment(a.data)))
                .map(e => `*${moment(e.data).format('DD/MM')}* - ${e.descricao} - R$ ${e.valor.toFixed(2)}`)
                .join('\n');
        }
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...backButton, parse_mode: 'Markdown' });
    }

    if (data === 'list_despesas') {
        let text = '*Lista de Despesas Fixas:*\n\n';
        if (state.despesasFixas.length === 0) {
            text = 'Nenhuma despesa fixa registrada.';
        } else {
            text += state.despesasFixas
                .map(d => `*${d.descricao}* - R$ ${d.valor.toFixed(2)} - _${d.status}_`)
                .join('\n');
        }
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...backButton, parse_mode: 'Markdown' });
    }

    if (data === 'pay_despesa') {
        const pendentes = state.despesasFixas.filter(d => d.status === 'pendente');
        if (pendentes.length === 0) {
            return;
        }
        const botoes = pendentes.map(d => ([
            { text: `${d.descricao} - R$ ${d.valor.toFixed(2)}`, callback_data: `confirm_pay_${d.id}` }
        ]));
        botoes.push([{ text: '⬅️ Voltar', callback_data: 'main_menu' }]);
        bot.editMessageText('Escolha a despesa para pagar:', {
            chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: botoes }
        });
    }

    if (data.startsWith('confirm_pay_')) {
        const despesaId = parseInt(data.replace('confirm_pay_', ''), 10);
        const despesa = state.despesasFixas.find(d => d.id === despesaId);
        if (despesa) {
            despesa.status = 'pago';
            despesa.dataPagamento = moment().format();
            const gastosDoMes = state.gastos.filter(g => moment(g.data).isSame(moment(), 'month'));
            bot.editMessageText(getResumoText(gastosDoMes, `Resumo de ${moment().format('MMMM')}`), { chat_id: chatId, message_id: messageId, ...backButton, parse_mode: 'Markdown' });
        }
    }
});

// Comando /resumo (mantido como está, se estiver implementado)
bot.onText(/\/resumo\s*(.*)/, (msg, match) => {
    // (Se estiver vazio, pode implementar depois)
});

// Comando /exportar
bot.onText(/\/exportar/, (msg) => {
    const chatId = msg.chat.id;
    const backup = JSON.stringify(state, null, 2);
    const filePath = `backup-${Date.now()}.json`;
    const fs = require('fs');
    fs.writeFileSync(filePath, backup);
    bot.sendDocument(chatId, filePath, {}, {
        filename: filePath,
        contentType: 'application/json'
    }).then(() => {
        fs.unlinkSync(filePath); // Apaga o arquivo depois de enviar
    }).catch((err) => {
        bot.sendMessage(chatId, '❌ Erro ao exportar o backup.');
        console.error(err);
    });
});

// Comando /importar (pede para enviar o arquivo)
bot.onText(/\/importar/, (msg) => {
    bot.sendMessage(msg.chat.id, '📤 Envie agora o arquivo `.json` do backup para importar os dados.');
});

// Quando o usuário envia o arquivo .json
bot.on('document', (msg) => {
    const chatId = msg.chat.id;
    const fileId = msg.document.file_id;

    bot.getFileLink(fileId).then((fileUrl) => {
        https.get(fileUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const imported = JSON.parse(data);
                    if (imported && typeof imported === 'object') {
                        state = imported;
                        bot.sendMessage(chatId, '✅ Backup importado com sucesso!');
                    } else {
                        bot.sendMessage(chatId, '❌ Arquivo inválido.');
                    }
                } catch (e) {
                    bot.sendMessage(chatId, '❌ Erro ao importar: arquivo mal formatado.');
                    console.error(e);
                }
            });
        });
    }).catch((err) => {
        bot.sendMessage(chatId, '❌ Não foi possível obter o arquivo.');
        console.error(err);
    });
});
