const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

// Configurações
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { webHook: { port: process.env.PORT || 10000 } });
const app = express();
const DATA_FILE = 'dados.json';

// Webhook
const url = process.env.RENDER_EXTERNAL_URL;
bot.setWebHook(`${url}/bot${token}`);
app.use(bodyParser.json());

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Utilitários
function carregarDados() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ saldo: 0, gastos: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function salvarDados(dados) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(dados, null, 2));
}

function formatarGasto(gasto, index) {
  return `${index + 1}. ${gasto.descricao} - R$ ${gasto.valor.toFixed(2)} (${gasto.tipo}) - ${gasto.data}`;
}

function resumoGastos(gastos) {
  const total = gastos.reduce((soma, g) => soma + g.valor, 0);
  const porTipo = gastos.reduce((resumo, g) => {
    resumo[g.tipo] = (resumo[g.tipo] || 0) + g.valor;
    return resumo;
  }, {});
  return `Total: R$ ${total.toFixed(2)}\n` +
    Object.entries(porTipo).map(([tipo, val]) => `${tipo}: R$ ${val.toFixed(2)}`).join('\n');
}

function extrairMes(nomeMes) {
  const meses = {
    janeiro: '01', fevereiro: '02', março: '03', abril: '04', maio: '05', junho: '06',
    julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
  };
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = meses[nomeMes.toLowerCase()];
  if (!mes) return null;
  return { prefixo: `${ano}-${mes}`, nome: nomeMes };
}

// Comandos

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Olá! Eu sou o bot de orçamento pessoal.\nUse /ajuda para ver os comandos disponíveis.');
});

bot.onText(/\/ajuda/, (msg) => {
  bot.sendMessage(msg.chat.id, `
Comandos disponíveis:
/saldo - Ver saldo atual
/adicionar - Adicionar novo gasto
/listar - Listar todos os gastos
/remover - Remover um gasto
/resumo - Resumo dos gastos do mês
/resumo nomeDoMes - Ex: /resumo abril
/exportar - Exportar os dados em CSV
/buscar palavra - Buscar gastos por palavra
/editar numero nova descrição - Editar gasto
  `.trim());
});

bot.onText(/\/saldo/, (msg) => {
  const dados = carregarDados();
  bot.sendMessage(msg.chat.id, `Saldo atual: R$ ${dados.saldo.toFixed(2)}`);
});

bot.onText(/\/adicionar/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Envie os gastos no formato:\nDescrição - valor - tipo (dinheiro/cartão/sodexo)');
});

bot.on('message', (msg) => {
  const dados = carregarDados();
  if (msg.text && !msg.text.startsWith('/')) {
    const linhas = msg.text.split('\n');
    let novos = [];
    linhas.forEach((linha) => {
      const partes = linha.split(' - ');
      if (partes.length !== 3) return;
      const [descricao, valorStr, tipo] = partes;
      const valor = parseFloat(valorStr.replace(',', '.'));
      if (isNaN(valor)) return;

      const gasto = {
        descricao: descricao.trim(),
        valor: valor,
        tipo: tipo.trim().toLowerCase(),
        data: new Date().toISOString().split('T')[0]
      };
      dados.gastos.push(gasto);
      if (gasto.tipo === 'dinheiro' || gasto.tipo === 'débito') {
        dados.saldo -= valor;
      }
      novos.push(gasto);
    });

    if (novos.length > 0) {
      salvarDados(dados);
      const resumo = resumoGastos(dados.gastos);
      bot.sendMessage(msg.chat.id, `Gastos adicionados com sucesso!\n\nResumo do mês:\n${resumo}\nSaldo: R$ ${dados.saldo.toFixed(2)}`);
    }
  }
});

bot.onText(/\/listar/, (msg) => {
  const dados = carregarDados();
  if (dados.gastos.length === 0) return bot.sendMessage(msg.chat.id, 'Nenhum gasto registrado.');
  const lista = dados.gastos.map(formatarGasto).join('\n');
  bot.sendMessage(msg.chat.id, `Gastos:\n${lista}`);
});

bot.onText(/\/remover (\d+)/, (msg, match) => {
  const dados = carregarDados();
  const index = parseInt(match[1]) - 1;
  if (index < 0 || index >= dados.gastos.length) {
    return bot.sendMessage(msg.chat.id, 'Número inválido.');
  }
  const removido = dados.gastos.splice(index, 1)[0];
  if (removido.tipo === 'dinheiro' || removido.tipo === 'débito') {
    dados.saldo += removido.valor;
  }
  salvarDados(dados);
  bot.sendMessage(msg.chat.id, `Gasto removido: ${removido.descricao} - R$ ${removido.valor.toFixed(2)}`);
});

bot.onText(/\/resumo(?: (\w+))?/, (msg, match) => {
  const dados = carregarDados();
  const filtro = match[1];
  let gastos = dados.gastos;
  if (filtro) {
    const info = extrairMes(filtro);
    if (!info) return bot.sendMessage(msg.chat.id, 'Mês inválido.');
    gastos = gastos.filter(g => g.data.startsWith(info.prefixo));
    bot.sendMessage(msg.chat.id, `Resumo de ${info.nome}:\n${resumoGastos(gastos)}\nSaldo: R$ ${dados.saldo.toFixed(2)}`);
  } else {
    const hoje = new Date();
    const prefixo = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    gastos = gastos.filter(g => g.data.startsWith(prefixo));
    bot.sendMessage(msg.chat.id, `Resumo do mês:\n${resumoGastos(gastos)}\nSaldo: R$ ${dados.saldo.toFixed(2)}`);
  }
});

bot.onText(/\/buscar (.+)/, (msg, match) => {
  const dados = carregarDados();
  const termo = match[1].toLowerCase();
  const encontrados = dados.gastos
    .filter(g => g.descricao.toLowerCase().includes(termo))
    .map(formatarGasto);
  if (encontrados.length === 0) return bot.sendMessage(msg.chat.id, 'Nenhum gasto encontrado.');
  bot.sendMessage(msg.chat.id, `Gastos encontrados:\n${encontrados.join('\n')}`);
});

bot.onText(/\/editar (\d+) (.+)/, (msg, match) => {
  const dados = carregarDados();
  const index = parseInt(match[1]) - 1;
  const novaDescricao = match[2].trim();
  if (index < 0 || index >= dados.gastos.length) return bot.sendMessage(msg.chat.id, 'Número inválido.');
  dados.gastos[index].descricao = novaDescricao;
  salvarDados(dados);
  bot.sendMessage(msg.chat.id, 'Gasto atualizado com sucesso.');
});

bot.onText(/\/exportar/, (msg) => {
  const dados = carregarDados();
  if (dados.gastos.length === 0) return bot.sendMessage(msg.chat.id, 'Nenhum dado para exportar.');
  const csv = 'Descrição,Valor,Tipo,Data\n' + dados.gastos.map(g =>
    `${g.descricao},${g.valor},${g.tipo},${g.data}`).join('\n');
  const filePath = path.join(__dirname, 'export.csv');
  fs.writeFileSync(filePath, csv);
  bot.sendDocument(msg.chat.id, filePath);
});
