const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

const token = '7978120569:AAFH8TqHqXelm0SFiK6iNHhkwIHS0eE64_c';
const bot = new TelegramBot(token, { polling: true });

const app = express();
const PORT = process.env.PORT || 3000;

// Dados em memória (pode substituir por DB depois)
let data = {
  saldo: 0,
  gastos: [],
  despesasFixas: [],
  usuarios: new Set()
};

// Função utilitária
function formatarResumo() {
  const totalDinheiro = data.gastos.filter(g => g.tipo === 'dinheiro').reduce((s, g) => s + g.valor, 0);
  const totalCartao = data.gastos.filter(g => g.tipo === 'cartao').reduce((s, g) => s + g.valor, 0);
  const totalSodexo = data.gastos.filter(g => g.tipo === 'sodexo').reduce((s, g) => s + g.valor, 0);
  const saldoAtual = data.saldo;

  return `*Resumo Atual:*\n\n` +
         `Saldo: *R$ ${saldoAtual.toFixed(2)}*\n` +
         `Gastos em Dinheiro: R$ ${totalDinheiro.toFixed(2)}\n` +
         `Gastos no Cartão: R$ ${totalCartao.toFixed(2)}\n` +
         `Gastos no SODEXO: R$ ${totalSodexo.toFixed(2)}`;
}

// Envia resumo com botão de voltar ao menu
function enviarResumo(chatId) {
  const resumo = formatarResumo();
  const menuBtn = {
    reply_markup: {
      inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'menu' }]]
    },
    parse_mode: 'Markdown'
  };
  bot.sendMessage(chatId, resumo, menuBtn);
}

// Envia mensagem para todos os usuários
function notificarTodos(mensagem, excetoId = null) {
  for (const userId of data.usuarios) {
    if (userId !== excetoId) {
      bot.sendMessage(userId, mensagem, {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'menu' }]]
        },
        parse_mode: 'Markdown'
      });
    }
  }
}

// Menu inicial
function menuPrincipal(chatId) {
  const opcoes = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Incluir saldo', callback_data: 'incluir_saldo' }],
        [{ text: '💸 Gasto dinheiro', callback_data: 'gasto_dinheiro' }],
        [{ text: '💳 Gasto cartão', callback_data: 'gasto_cartao' }],
        [{ text: '🍽️ Gasto SODEXO', callback_data: 'gasto_sodexo' }],
        [{ text: '📋 Listar gastos', callback_data: 'listar_gastos' }],
        [{ text: '📅 Listar despesas', callback_data: 'listar_despesas' }],
      ]
    }
  };
  bot.sendMessage(chatId, 'Escolha uma opção:', opcoes);
}

// Lida com comandos
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  data.usuarios.add(chatId);
  menuPrincipal(chatId);
});

// Lida com botões
bot.on('callback_query', query => {
  const chatId = query.message.chat.id;
  const acao = query.data;

  data.usuarios.add(chatId);

  switch (acao) {
    case 'menu':
      menuPrincipal(chatId);
      break;
    case 'incluir_saldo':
      bot.sendMessage(chatId, 'Envie o valor do saldo (ex: 150.50)');
      bot.once('message', msg => {
        const valor = parseFloat(msg.text.replace(',', '.'));
        if (!isNaN(valor)) {
          data.saldo += valor;
          const resumo = formatarResumo();
          bot.sendMessage(chatId, '*Saldo incluído com sucesso!*\n\n' + resumo, {
            reply_markup: {
              inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'menu' }]]
            },
            parse_mode: 'Markdown'
          });
          notificarTodos(`*Novo saldo adicionado: R$ ${valor.toFixed(2)}*\n\n${resumo}`, chatId);
        } else {
          bot.sendMessage(chatId, 'Valor inválido. Tente novamente.');
        }
      });
      break;
    case 'gasto_dinheiro':
    case 'gasto_cartao':
    case 'gasto_sodexo':
      const tipo = acao.split('_')[1];
      bot.sendMessage(chatId, `Envie o valor e descrição do gasto em ${tipo} (ex: 20 uber)`);
      bot.once('message', msg => {
        const [valorStr, ...descArray] = msg.text.split(' ');
        const valor = parseFloat(valorStr.replace(',', '.'));
        const descricao = descArray.join(' ') || 'Sem descrição';
        if (!isNaN(valor)) {
          data.gastos.push({ tipo, valor, descricao, data: new Date().toISOString() });
          if (tipo === 'dinheiro') data.saldo -= valor;
          const resumo = formatarResumo();
          bot.sendMessage(chatId, `*Gasto registrado: R$ ${valor.toFixed(2)} (${descricao})*\n\n${resumo}`, {
            reply_markup: {
              inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'menu' }]]
            },
            parse_mode: 'Markdown'
          });
          notificarTodos(`*Novo gasto registrado:* R$ ${valor.toFixed(2)} (${descricao})\n\n${resumo}`, chatId);
        } else {
          bot.sendMessage(chatId, 'Valor inválido. Tente novamente.');
        }
      });
      break;
    case 'listar_gastos':
      if (data.gastos.length === 0) {
        bot.sendMessage(chatId, 'Nenhum gasto registrado.');
        return;
      }
      const lista = data.gastos.map((g, i) =>
        `${i + 1}. R$ ${g.valor.toFixed(2)} - ${g.descricao} [${g.tipo}]`).join('\n');
      bot.sendMessage(chatId, `*Gastos registrados:*\n\n${lista}`, {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'menu' }]],
          parse_mode: 'Markdown'
        }
      });
      break;
    case 'listar_despesas':
      if (data.despesasFixas.length === 0) {
        bot.sendMessage(chatId, 'Nenhuma despesa fixa cadastrada.');
        return;
      }
      const despesas = data.despesasFixas.map((d, i) =>
        `${i + 1}. ${d.nome} - R$ ${d.valor.toFixed(2)} (${d.status})`).join('\n');
      bot.sendMessage(chatId, `*Despesas fixas:*\n\n${despesas}`, {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'menu' }]],
          parse_mode: 'Markdown'
        }
      });
      break;
    default:
      bot.sendMessage(chatId, 'Opção não reconhecida.');
  }
});

// Rota para manter render ativo
app.get('/', (req, res) => {
  res.send('Bot está rodando!');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
