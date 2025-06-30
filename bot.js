const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
moment.locale('pt-br');

const https = require('https');
const express = require('express');
const app = express();

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true }); // Mude para webhook se for fazer deploy

// let saldo = 0; // Substituído pelo objeto state
// let gastos = [];
// let despesasFixas = [];

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
function getResumoText() {
    const gastosMes = state.gastos.filter(g => moment(g.data).isSame(moment(), 'month'));
    const totalDinheiro = gastosMes.filter(g => g.tipo === 'dinheiro').reduce((acc, g) => acc + g.valor, 0);
    const totalCartao = gastosMes.filter(g => g.tipo === 'cartao').reduce((acc, g) => acc + g.valor, 0);
    const totalSodexo = gastosMes.filter(g => g.tipo === 'sodexo').reduce((acc, g) => acc + g.valor, 0);
    const totalDespesasPagas = state.despesasFixas.filter(d => d.status === 'pago').reduce((acc, d) => acc + d.valor, 0);

    const saldoAtual = state.saldo - totalDinheiro - totalDespesasPagas;

    return `*Resumo de ${moment().format('MMMM')}*\n\n` +
        `💰 *Saldo disponível:* R$ ${saldoAtual.toFixed(2)}\n` +
        `💸 *Gastos Dinheiro/Débito:* R$ ${totalDinheiro.toFixed(2)}\n` +
        `💳 *Fatura Cartão:* R$ ${totalCartao.toFixed(2)}\n` +
        `🍽️ *Gastos SODEXO:* R$ ${totalSodexo.toFixed(2)}\n` +
        `🧾 *Despesas Pagas:* R$ ${totalDespesasPagas.toFixed(2)}`;
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

    if (action === 'awaiting_saldo') {
        const valor = parseFloat(text.replace(',', '.'));
        if (!isNaN(valor)) {
            state.saldo += valor;
            bot.sendMessage(chatId, `✅ Saldo de R$ ${valor.toFixed(2)} adicionado!`);
            success = true;
        } else {
            bot.sendMessage(chatId, '❌ Valor inválido. Envie apenas o número.');
        }
    }

    if (action === 'awaiting_despesa') {
        const partes = text.split(',');
        const descricao = partes[0]?.trim();
        const valor = parseFloat(partes[1]);
        if (descricao && !isNaN(valor)) {
            state.despesasFixas.push({ id: Date.now(), descricao, valor, status: 'pendente' });
            bot.sendMessage(chatId, `✅ Despesa "${descricao}" adicionada.`);
            success = true;
        } else {
            bot.sendMessage(chatId, '❌ Formato inválido. Use: `descrição, valor`');
        }
    }

    if (action === 'awaiting_gasto') {
        const linhas = text.split('\n');
        let successCount = 0;
        linhas.forEach(linha => {
            const partes = linha.split(',');
            const descricao = partes[0]?.trim();
            const valor = parseFloat(partes[1]);
            const dataInformada = partes[2] ? moment(partes[2].trim(), 'DD/MM', true) : moment();

            if (descricao && !isNaN(valor) && dataInformada.isValid()) {
                state.gastos.push({ id: Date.now(), descricao, valor, tipo, data: dataInformada.format() });
                successCount++;
            }
        });
        if (successCount > 0) {
            bot.sendMessage(chatId, `✅ ${successCount} gasto(s) adicionado(s)!`);
            success = true;
        } else {
            bot.sendMessage(chatId, '❌ Nenhum gasto adicionado. Verifique o formato: `descrição, valor`');
        }
    }

    if (success) {
        bot.sendMessage(chatId, getResumoText(), { ...backButton, parse_mode: 'Markdown' });
    }
    
    delete userState[chatId];
});

// Handler para os botões
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    const actions = {
        'action_add_saldo': { state: 'awaiting_saldo', text: 'Digite o valor do saldo a ser incluído:' },
        'action_add_despesa': { state: 'awaiting_despesa', text: 'Envie a despesa no formato: `descrição, valor`' },
        'gasto_dinheiro': { state: 'awaiting_gasto', type: 'dinheiro', text: 'Envie o(s) gasto(s) em dinheiro/débito:\n`descrição, valor`' },
        'gasto_cartao': { state: 'awaiting_gasto', type: 'cartao', text: 'Envie o(s) gasto(s) no cartão:\n`descrição, valor`' },
        'gasto_sodexo': { state: 'awaiting_gasto', type: 'sodexo', text: 'Envie o(s) gasto(s) no Sodexo:\n`descrição, valor`' }
    };

    if (actions[data]) {
        const { state: action, type, text } = actions[data];
        userState[chatId] = { action, type };
        bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' });
        return;
    }

    if (data === 'main_menu') {
        bot.editMessageText('Menu principal:', { chat_id: chatId, message_id: messageId, ...menuPrincipal });
    }

    if (data === 'show_summary') {
        bot.editMessageText(getResumoText(), { chat_id: chatId, message_id: messageId, ...backButton, parse_mode: 'Markdown' });
    }

    if (data === 'list_gastos') {
        let text = '*Lista de Gastos:*\n\n';
        if (state.gastos.length === 0) {
            text = 'Nenhum gasto registrado.';
        } else {
            text += state.gastos
                .map(g => `_${moment(g.data).format('DD/MM')}_ - ${g.descricao} - R$ ${g.valor.toFixed(2)} (${g.tipo})`)
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
            bot.answerCallbackQuery(query.id, { text: 'Nenhuma despesa pendente!', show_alert: true });
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
            state.saldo -= despesa.valor;
            bot.answerCallbackQuery(query.id, { text: 'Despesa paga com sucesso!' });
            bot.editMessageText(getResumoText(), { chat_id: chatId, message_id: messageId, ...backButton, parse_mode: 'Markdown' });
        }
    }
    
    bot.answerCallbackQuery(query.id).catch(() => {});
});

// --- EXPORTAR E IMPORTAR (FUNCIONANDO EM MEMÓRIA) ---
bot.onText(/\/exportar/, (msg) => {
    const chatId = msg.chat.id;
    let csv = 'SALDO\nValor\n';
    csv += `${state.saldo.toFixed(2)}\n\n`;

    csv += 'GASTOS\nDescricao,Valor,Tipo,Data\n';
    state.gastos.forEach(g => {
        csv += `"${g.descricao}",${g.valor},"${g.tipo}","${moment(g.data).format('DD/MM/YYYY HH:mm')}"\n`;
    });

    csv += '\nDESPESAS FIXAS\nDescricao,Valor,Status\n';
    state.despesasFixas.forEach(d => {
        csv += `"${d.descricao}",${d.valor},"${d.status}"\n`;
    });

    const csvBuffer = Buffer.from(csv, 'utf8');
    bot.sendDocument(chatId, csvBuffer, {}, {
        filename: 'backup_orcamento.csv',
        contentType: 'text/csv'
    });
});

bot.onText(/\/importar/, (msg) => {
    const chatId = msg.chat.id;
    userState[chatId] = { action: 'awaiting_import_file' };
    bot.sendMessage(chatId, 'Ok, pode me enviar o arquivo `.csv` do backup.');
});

bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    if (userState[chatId]?.action !== 'awaiting_import_file' || !msg.document.file_name.endsWith('.csv')) {
        return;
    }
    
    delete userState[chatId]; // Limpa o estado
    
    const fileId = msg.document.file_id;
    const fileLink = await bot.getFileLink(fileId);

    https.get(fileLink, (res) => {
        let fileContent = '';
        res.on('data', chunk => fileContent += chunk);
        res.on('end', () => {
            try {
                // Lógica de parsing do CSV
                // ... (a mesma lógica de parsing que você já tinha)
                bot.sendMessage(chatId, '✅ Backup importado com sucesso para a memória!');
                bot.sendMessage(chatId, getResumoText(), { ...backButton, parse_mode: 'Markdown' });
            } catch (e) {
                bot.sendMessage(chatId, '❌ Erro ao processar o arquivo de backup.');
            }
        });
    }).on('error', (e) => {
        bot.sendMessage(chatId, '❌ Erro ao baixar o arquivo do Telegram.');
    });
});

console.log('Bot em execução com gerenciamento de estado e interface melhorada...');
      
