const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');

const token = '7978120569:AAFDKqGDFhCa8JUUR4Y-JL_zmYbFPBvj_0E'; // Substitua pelo seu token real
const bot = new TelegramBot(token, { webHook: true }); // webhook, sem polling

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

bot.onText(/\/excluir gasto (\d+)/, (msg, match) => {
  const index = parseInt(match[1]) - 1;
  if (dados.gastos[index]) {
    const removido = dados.gastos.splice(index, 1)[0];
    if (removido.tipo === 'dinheiro') dados.saldo += removido.valor;
    salvarDados();
    bot.sendMessage(msg.chat.id, `Gasto "${removido.nome}" removido.`);
  } else {
    bot.sendMessage(msg.chat.id, 'Índice inválido.');
  }
});

bot.onText(/\/excluir despesa (\d+)/, (msg, match) => {
  const index = parseInt(match[1]) - 1;
  if (dados.despesas[index]) {
    const removido = dados.despesas.splice(index, 1)[0];
    if (removido.pago) dados.saldo += removido.valor;
    salvarDados();
    bot.sendMessage(msg.chat.id, `Despesa "${removido.nome}" removida.`);
  } else {
    bot.sendMessage(msg.chat.id, 'Índice inválido.');
  }
});

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

  const dataAtual = new Date().toISOString().split('T')[0]; // AAAA-MM-DD

  linhas.forEach(linha => {
    const partes = linha.split(',');
    if (partes.length === 2) {
      const nome = partes[0].trim();
      const valor = parseFloat(partes[1].trim());
      if (!isNaN(valor)) {
        if (estado.tipo === 'despesa') {
          dados.despesas.push({ nome, valor, pago: false, data: dataAtual });
          resultados.push(`${nome} - R$ ${valor.toFixed(2)} (❌ pendente)`);
        } else if (estado.tipo === 'saldo') {
          dados.saldo += valor;
          dados.gastos.push({ nome, valor, tipo: 'saldo', data: dataAtual }); // opcional: registrar saldo com data
          resultados.push(`${nome} - R$ ${valor.toFixed(2)}`);
        } else {
          dados.gastos.push({ nome, valor, tipo: estado.tipo, data: dataAtual });
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
    const instrucao = tipoA === 'despesa' ? 'Digite as despesas no formato "nome, valor", uma por linha:' : 'Digite os valores no formato "nome, valor", uma por linha:';
    bot.sendMessage(chatId, instrucao);
  }

  if (tipo === 'listar_gastos') {
  const lista = dados.gastos
    .map((g, i) => {
      const data = g.data ? `📅 ${g.data}` : '';
      return `${i + 1}. ${g.nome} - R$ ${g.valor.toFixed(2)} (${g.tipo}) ${data}`;
    })
    .join('\n') || 'Nenhum gasto registrado.';
  const total = dados.gastos.reduce((s, g) => s + g.valor, 0);
  bot.sendMessage(chatId, `Gastos:\n${lista}\n\nTOTAL: R$ ${total.toFixed(2)}`, botaoVoltarMenu());
  }

  if (tipo === 'listar_despesas') {
    const lista = dados.despesas.map((d, i) => `${i + 1}. ${d.nome} - R$ ${d.valor.toFixed(2)} [${d.pago ? '✅ Pago' : '❌ Pendente'}]`).join('\n') || 'Nenhuma despesa registrada.';
    const total = dados.despesas.reduce((s, d) => s + d.valor, 0);
    bot.sendMessage(chatId, `Despesas:\n${lista}\n\nTOTAL: R$ ${total.toFixed(2)}`, botaoVoltarMenu());
  }

  if (tipo === 'pagar_despesa') {
    const pendentes = dados.despesas.map((d, i) => ({ ...d, index: i })).filter(d => !d.pago);
    if (pendentes.length === 0) {
      bot.sendMessage(chatId, 'Nenhuma despesa pendente.', botaoVoltarMenu());
      return;
    }
    const botoes = pendentes.map(d => [{ text: `${d.nome} - R$ ${d.valor.toFixed(2)}`, callback_data: `pagar_${d.index}` }]);
    bot.sendMessage(chatId, 'Selecione a despesa para marcar como paga:', { reply_markup: { inline_keyboard: botoes } });
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
const path = require('path');

// Comando para exportar os dados
bot.onText(/\/exportar/, (msg) => {
  const chatId = msg.chat.id;
  const caminhoBackup = path.resolve(__dirname, 'dados.json');

  if (fs.existsSync(caminhoBackup)) {
    bot.sendDocument(chatId, caminhoBackup, {}, { filename: 'backup_dados.json' });
  } else {
    bot.sendMessage(chatId, 'Nenhum backup encontrado.');
  }
});

// Comando para importar dados de um arquivo .json
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.document.file_id;
  const fileName = msg.document.file_name;

  if (!fileName.endsWith('.json')) {
    bot.sendMessage(chatId, 'Envie um arquivo JSON válido para importar.');
    return;
  }

  try {
    const fileLink = await bot.getFileLink(fileId);
    const https = require('https');

    https.get(fileLink, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const dadosImportados = JSON.parse(data);
          if (dadosImportados.saldo !== undefined && Array.isArray(dadosImportados.gastos)) {
            dados = dadosImportados;
            salvarDados();
            bot.sendMessage(chatId, 'Backup importado com sucesso!');
          } else {
            bot.sendMessage(chatId, 'Arquivo inválido. Certifique-se de que é um backup do bot.');
          }
        } catch (e) {
          bot.sendMessage(chatId, 'Erro ao ler o arquivo. Verifique se ele está correto.');
        }
      });
    });
  } catch (err) {
    bot.sendMessage(chatId, 'Erro ao importar backup.');
  }
});

app.listen(PORT, () => console.log('Servidor rodando...'));

// ... (todo seu código original permanece igual até o final)

bot.onText(/\/excluir saldo (\d+)/, (msg, match) => {
  const index = parseInt(match[1]) - 1;

  if (isNaN(index) || index < 0 || index >= dados.saldos.length) {
    bot.sendMessage(msg.chat.id, 'Índice inválido. Use /excluir saldo <número>.');
    return;
  }

  const removido = dados.saldos.splice(index, 1)[0];
  dados.saldo -= removido.valor;

  salvarDados();
  bot.sendMessage(msg.chat.id, `Saldo de R$ ${removido.valor.toFixed(2)} removido com sucesso.`);
});

  if (removido.length > 0) {
    salvarDados();
    bot.sendMessage(msg.chat.id, removido.join('\n'));
  } else {
    bot.sendMessage(msg.chat.id, 'Índice inválido.');
  }
});

bot.onText(/\/resumo (\w+)/, (msg, match) => {
  const mesTexto = match[1].toLowerCase();
  const meses = {
    janeiro: 0, fevereiro: 1, março: 2, abril: 3, maio: 4, junho: 5,
    julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11
  };
  if (!(mesTexto in meses)) {
    bot.sendMessage(msg.chat.id, 'Mês inválido. Ex: /resumo abril');
    return;
  }
  const mesIndex = meses[mesTexto];
  const gastosMes = dados.gastos.filter(g => {
    const data = new Date(g.data || 0);
    return data.getMonth() === mesIndex;
  });
  if (gastosMes.length === 0) {
    bot.sendMessage(msg.chat.id, `Nenhum gasto registrado em ${mesTexto}.`);
    return;
  }
  const resumo = gastosMes.map((g, i) => `${i + 1}. ${g.nome} - R$ ${g.valor.toFixed(2)} (${g.tipo})`).join('\n');
  const total = gastosMes.reduce((s, g) => s + g.valor, 0);
  bot.sendMessage(msg.chat.id, `Resumo de ${mesTexto}:\n${resumo}\n\nTOTAL: R$ ${total.toFixed(2)}`, botaoVoltarMenu());
});

bot.onText(/\/ajuda/, (msg) => {
  const ajuda = `
Comandos disponíveis:
/excluir gasto N – Exclui o gasto número N.
/excluir despesa N – Exclui a despesa número N.
/excluir saldo N – Exclui o saldo número N.
/resumo [mês] – Mostra os gastos do mês. Ex: /resumo abril
/listar_gastos – Lista todos os gastos.
/listar_despesas – Lista todas as despesas.
/start – Exibe o menu principal.
  `.trim();
  bot.sendMessage(msg.chat.id, ajuda, botaoVoltarMenu());
});

// Adiciona data aos gastos registrados
function registrarGastoComData(gasto) {
  return { ...gasto, data: new Date().toISOString() };
}

// Atualiza os pontos onde gastos são registrados
const originalPushGasto = dados.gastos.push.bind(dados.gastos);
dados.gastos.push = function (...items) {
  const atualizados = items.map(registrarGastoComData);
  return originalPushGasto(...atualizados);
};
