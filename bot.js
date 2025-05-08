const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');

const token = '7978120569:AAFH8TqHqXelm0SFiK6iNHhkwIHS0eE64_c'; // Substitua pelo seu token real
const bot = new TelegramBot(token); // webhook, sem polling

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

let dados = { saldo: 0, gastos: [], despesas: [], usuarios: [] };

function salvarDados() {
  fs.writeFileSync('dados.json', JSON.stringify(dados));
}

function carregarDados() {
  if (fs.existsSync('dados.json')) {
    dados = JSON.parse(fs.readFileSync('dados.json'));
  }
}

carregarDados();

function formatarResumo() {
  const dinheiro = dados.gastos.filter(g => g.tipo === 'dinheiro').reduce((s, g) => s + g.valor, 0);
  const cartao = dados.gastos.filter(g => g.tipo === 'cartao').reduce((s, g) => s + g.valor, 0);
  const sodexo = dados.gastos.filter(g => g.tipo === 'sodexo').reduce((s, g) => s + g.valor, 0);
  return `Resumo atual:\nSaldo: R$ ${dados.saldo.toFixed(2)}\nGasto em dinheiro/débito: R$ ${dinheiro.toFixed(2)}\nGasto no cartão: R$ ${cartao.toFixed(2)}\nGasto no SODEXO: R$ ${sodexo.toFixed(2)}`;
}

function menuPrincipal() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '➕ Incluir saldo', callback_data: 'incluir_saldo' },
          { text: '➕ Incluir despesa', callback_data: 'incluir_despesa' }
        ],
        [
          { text: '💵 Gasto dinheiro', callback_data: 'gasto_dinheiro' },
          { text: '💳 Gasto cartão', callback_data: 'gasto_cartao' },
          { text: '🍽️ Gasto SODEXO', callback_data: 'gasto_sodexo' }
        ],
        [
          { text: '📋 Listar gastos', callback_data: 'listar_gastos' },
          { text: '📄 Listar despesas', callback_data: 'listar_despesas' }
        ],
        [
          { text: '✅ Pagar despesa', callback_data: 'pagar_despesa' }
        ]
      ]
    }
  };
}

function botaoVoltarMenu() {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'voltar_menu' }]]
    }
  };
}

function notificarTodos(mensagem, excetoId) {
  dados.usuarios.forEach(id => {
    if (id !== excetoId) {
      bot.sendMessage(id, mensagem, botaoVoltarMenu());
    }
  });
}

const estadosUsuario = {};

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (!dados.usuarios.includes(chatId)) {
    dados.usuarios.push(chatId);
    salvarDados();
  }

  if (msg.text === '/start') {
    bot.sendMessage(chatId, 'Bem-vindo ao bot de orçamento!', menuPrincipal());
    return;
  }

  const estado = estadosUsuario[chatId];
  if (!estado) return;

  const linhas = msg.text.split('\n');
  const resultados = [];

  linhas.forEach(linha => {
    const partes = linha.split(',');
    if (partes.length === 2) {
      const nome = partes[0].trim();
      const valor = parseFloat(partes[1].trim());
      if (!isNaN(valor)) {
        if (estado.tipo === 'despesa') {
          dados.despesas.push({ nome, valor, pago: false });
          resultados.push(`${nome} - R$ ${valor.toFixed(2)} (pendente)`);
        } else if (estado.tipo === 'saldo') {
          dados.saldo += valor;
          resultados.push(`${nome} - R$ ${valor.toFixed(2)}`);
        } else {
          dados.gastos.push({ nome, valor, tipo: estado.tipo });
          if (estado.tipo === 'dinheiro') dados.saldo -= valor;
          resultados.push(`${nome} - R$ ${valor.toFixed(2)}`);
        }
      }
    }
  });

  delete estadosUsuario[chatId];
  salvarDados();

  const tipoStr = estado.tipo === 'despesa' ? 'Despesas' : (estado.tipo === 'saldo' ? 'Saldo' : 'Gastos');
  const resposta = `${tipoStr} registradas:\n` + resultados.join('\n') + '\n\n' + formatarResumo();
  bot.sendMessage(chatId, resposta, botaoVoltarMenu());
  notificarTodos(resposta, chatId);
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const tipo = query.data;

  if (tipo === 'voltar_menu') {
    bot.sendMessage(chatId, 'Menu principal:', menuPrincipal());
    return;
  }

  if (tipo.startsWith('incluir_') || tipo.startsWith('gasto_')) {
    const tipoA = tipo.split('_')[1];
    estadosUsuario[chatId] = { tipo: tipoA === 'despesa' ? 'despesa' : tipoA };
    const instrucao = tipoA === 'despesa'
      ? 'Digite as despesas no formato "nome, valor", uma por linha:'
      : 'Digite os valores no formato "nome, valor", uma por linha:';
    bot.sendMessage(chatId, instrucao);
  }

  if (tipo === 'listar_gastos') {
    const lista = dados.gastos.map(g => `${g.nome} - R$ ${g.valor.toFixed(2)} (${g.tipo})`).join('\n') || 'Nenhum gasto registrado.';
    bot.sendMessage(chatId, `Gastos:\n${lista}`, botaoVoltarMenu());
  }

  if (tipo === 'listar_despesas') {
    const lista = dados.despesas.map((d, i) => `${i + 1}. ${d.nome} - R$ ${d.valor.toFixed(2)} [${d.pago ? 'Pago' : 'Pendente'}]`).join('\n') || 'Nenhuma despesa registrada.';
    bot.sendMessage(chatId, `Despesas:\n${lista}`, botaoVoltarMenu());
  }

  if (tipo === 'pagar_despesa') {
    const pendentes = dados.despesas.map((d, i) => ({ ...d, index: i })).filter(d => !d.pago);
    if (pendentes.length === 0) {
      bot.sendMessage(chatId, 'Nenhuma despesa pendente.', botaoVoltarMenu());
      return;
    }
    const botoes = pendentes.map(d => [{
      text: `${d.nome} - R$ ${d.valor.toFixed(2)}`,
      callback_data: `pagar_${d.index}`
    }]);
    bot.sendMessage(chatId, 'Selecione a despesa para marcar como paga:', {
      reply_markup: { inline_keyboard: botoes }
    });
  }

  if (tipo.startsWith('pagar_')) {
    const index = parseInt(tipo.split('_')[1]);
    const despesa = dados.despesas[index];
    if (despesa && !despesa.pago) {
      despesa.pago = true;
      dados.saldo -= despesa.valor;
      salvarDados();
      const resposta = `Despesa "${despesa.nome}" marcada como paga.\n\n` + formatarResumo();
      bot.sendMessage(chatId, resposta, botaoVoltarMenu());
      notificarTodos(resposta, chatId);
    }
  }
});

// Página inicial para manter o bot ativo via UptimeRobot
app.get('/', (req, res) => res.send('Bot está rodando!'));

// Webhook do Telegram
bot.setWebHook(`https://bottelegram-q3d6.onrender.com/bot${token}`);

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, () => console.log('Servidor rodando...'));
