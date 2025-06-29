const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
moment.locale('pt-br');

const fs = require('fs');
const path = require('path');
const express = require('express');

// --- CONFIGURAÇÃO ---
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Erro: BOT_TOKEN não foi definido nas variáveis de ambiente.');
  process.exit(1);
}

const bot = new TelegramBot(token);
const app = express();
const DATA_FILE = path.join(__dirname, 'data.json');

// --- GERENCIAMENTO DE DADOS ---
let state = {
  saldo: 0,
  gastos: [],
  despesasFixas: [],
};

// Objeto para gerenciar o estado da conversa por chat
let userState = {};

// Carrega os dados do arquivo JSON ao iniciar
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      state = JSON.parse(data);
      // Garante que as propriedades existam
      state.saldo = state.saldo || 0;
      state.gastos = state.gastos || [];
      state.despesasFixas = state.despesasFixas || [];
    } else {
      saveData(); // Cria o arquivo se não existir
    }
  } catch (error) {
    console.error('Erro ao carregar dados:', error);
  }
}

// Salva os dados no arquivo JSON após qualquer alteração
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('Erro ao salvar dados:', error);
  }
}

// --- WEBHOOK (Não precisa de alteração) ---
bot.setWebHook(`https://bottelegram-q3d6.onrender.com/bot${token}`);
app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  loadData(); // Carrega os dados quando o servidor inicia
});


// --- INTERFACE DO BOT (MENUS) ---
const menuPrincipal = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '➕ Incluir saldo', callback_data: 'action_add_saldo' }, { text: '➕ Incluir despesa', callback_data: 'action_add_despesa' }],
      [{ text: '💸 Gasto dinheiro/débito', callback_data: 'gasto_dinheiro' }, { text: '💳 Gasto cartão', callback_data: 'gasto_cartao' }],
      [{ text: '🍽️ Gasto SODEXO', callback_data: 'gasto_sodexo' }, { text: '📋 Listar gastos', callback_data: 'list_gastos' }],
      [{ text: '📑 Listar despesas', callback_data: 'list_despesas' }, { text: '💸 Pagar despesa', callback_data: 'pay_despesa' }],
      [{ text: '📊 Resumo do Mês', callback_data: 'show_summary'}]
    ]
  }
};

const backButton = {
  reply_markup: {
    inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'main_menu' }]]
  }
};


// --- FUNÇÕES AUXILIARES ---

// Gera o texto do resumo mensal
function getResumoText() {
  const gastosMes = state.gastos.filter(g => moment(g.data).isSame(moment(), 'month'));
  const totalDinheiro = gastosMes.filter(g => g.tipo === 'dinheiro').reduce((acc, g) => acc + g.valor, 0);
  const totalCartao = gastosMes.filter(g => g.tipo === 'cartao').reduce((acc, g) => acc + g.valor, 0);
  const totalSodexo = gastosMes.filter(g => g.tipo === 'sodexo').reduce((acc, g) => acc + g.valor, 0);
  
  // Despesas pagas no mês atual
  const totalDespesasPagasMes = state.despesasFixas
    .filter(d => d.status === 'pago' && moment(d.dataPagamento).isSame(moment(), 'month'))
    .reduce((acc, d) => acc + d.valor, 0);

  // O saldo atual considera o saldo inicial menos os gastos em dinheiro e as despesas pagas
  const saldoAtual = state.saldo - totalDinheiro - totalDespesasPagasMes;

  return `*Resumo de ${moment().format('MMMM')}*\n\n` +
    `💰 *Saldo disponível:* R$ ${saldoAtual.toFixed(2)}\n` +
    `💸 *Gastos Dinheiro/Débito:* R$ ${totalDinheiro.toFixed(2)}\n` +
    `💳 *Fatura Cartão:* R$ ${totalCartao.toFixed(2)}\n` +
    `🍽️ *Gastos SODEXO:* R$ ${totalSodexo.toFixed(2)}\n` +
    `🧾 *Despesas Pagas no Mês:* R$ ${totalDespesasPagasMes.toFixed(2)}`;
}


// --- HANDLERS DO BOT ---

// Comando /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Bem-vindo ao bot de orçamento!', menuPrincipal);
});

// Handler para todas as mensagens de texto
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignora comandos para não serem processados aqui
  if (text.startsWith('/')) {
    return;
  }

  // Verifica se o usuário está em algum "estado" de espera
  const currentState = userState[chatId];
  if (!currentState) {
    return; // Não faz nada se não estiver esperando uma resposta
  }
  
  const { action, type } = currentState;

  if (action === 'awaiting_saldo') {
      const valor = parseFloat(text.replace(',', '.'));
      if (!isNaN(valor)) {
        state.saldo += valor;
        saveData();
        bot.sendMessage(chatId, `✅ Saldo de R$ ${valor.toFixed(2)} adicionado!`);
        bot.sendMessage(chatId, getResumoText(), { ...backButton, parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, '❌ Valor inválido. Envie apenas o número.');
      }
  }

  if (action === 'awaiting_despesa') {
      const partes = text.split(',');
      const descricao = partes[0]?.trim();
      const valor = parseFloat(partes[1]);
      if (descricao && !isNaN(valor)) {
        // Usamos timestamp como ID único
        state.despesasFixas.push({ id: Date.now(), descricao, valor, status: 'pendente' });
        saveData();
        bot.sendMessage(chatId, `✅ Despesa "${descricao}" adicionada como pendente.`);
        bot.sendMessage(chatId, getResumoText(), { ...backButton, parse_mode: 'Markdown' });
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
          state.gastos.push({ descricao, valor, tipo, data: dataInformada.format() });
          successCount++;
        }
      });
      if(successCount > 0){
        saveData();
        bot.sendMessage(chatId, `✅ ${successCount} gasto(s) adicionado(s) com sucesso!`);
        bot.sendMessage(chatId, getResumoText(), { ...backButton, parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, '❌ Nenhum gasto adicionado. Verifique o formato: `descrição, valor`');
      }
  }
  
  // Limpa o estado do usuário após processar a mensagem
  delete userState[chatId];
});


// Handler para os botões do menu (inline keyboard)
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  // Ações que pedem input do usuário
  if (data === 'action_add_saldo') {
    userState[chatId] = { action: 'awaiting_saldo' };
    bot.editMessageText('Digite o valor do saldo a ser incluído:', { chat_id: chatId, message_id: messageId });
  }
  
  if (data === 'action_add_despesa') {
    userState[chatId] = { action: 'awaiting_despesa' };
    bot.editMessageText('Envie a despesa no formato: `descrição, valor`', { chat_id: chatId, message_id: messageId });
  }

  if (data.startsWith('gasto_')) {
    const tipo = data.replace('gasto_', '');
    userState[chatId] = { action: 'awaiting_gasto', type: tipo };
    bot.editMessageText('Envie os gastos no formato: `descrição, valor`\n(Pode enviar vários, um por linha)', { chat_id: chatId, message_id: messageId });
  }

  // Ações que mostram informações
  if (data === 'show_summary') {
      bot.editMessageText(getResumoText(), { chat_id: chatId, message_id: messageId, ...backButton, parse_mode: 'Markdown' });
  }

  if (data === 'main_menu') {
    bot.editMessageText('Menu principal:', { chat_id: chatId, message_id: messageId, ...menuPrincipal });
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
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: botoes }
      });
  }

  if (data.startsWith('confirm_pay_')) {
      const despesaId = parseInt(data.replace('confirm_pay_', ''), 10);
      const despesaIndex = state.despesasFixas.findIndex(d => d.id === despesaId);

      if (despesaIndex !== -1) {
          state.despesasFixas[despesaIndex].status = 'pago';
          state.despesasFixas[despesaIndex].dataPagamento = moment().format(); // Salva data do pagamento
          saveData();
          bot.answerCallbackQuery(query.id, { text: 'Despesa paga com sucesso!' });
          bot.editMessageText(getResumoText(), { chat_id: chatId, message_id: messageId, ...backButton, parse_mode: 'Markdown' });
      } else {
          bot.answerCallbackQuery(query.id, { text: 'Erro: Despesa não encontrada.', show_alert: true });
      }
  }

  // Responde ao callback para o Telegram saber que foi processado (remove o "carregando" do botão)
  if(!data.startsWith('confirm_pay_')) bot.answerCallbackQuery(query.id);
});

// Comandos de utilidade (/exportar, /importar, etc.)
// Não foram alterados, mas se beneficiariam da nova estrutura de dados (state)
// ... (O restante do seu código para /exportar, /importar, /ajuda, /resumo pode ser adaptado para usar o objeto `state`)

