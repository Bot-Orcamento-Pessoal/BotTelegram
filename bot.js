// bot.js const TelegramBot = require('node-telegram-bot-api'); const fs = require('fs'); const express = require('express'); const bodyParser = require('body-parser');

const token = process.env.BOT_TOKEN || '7978120569:AAFH8TqHqXelm0SFiK6iNHhkwIHS0eE64_c'; const bot = new TelegramBot(token); const app = express(); app.use(bodyParser.json());

let data = { saldo: 0, gastos: [], despesasFixas: [], usuarios: [] };

const salvar = () => { fs.writeFileSync('not.json', JSON.stringify(data, null, 2)); };

const carregar = () => { if (fs.existsSync('not.json')) { data = JSON.parse(fs.readFileSync('not.json')); } };

carregar();

const menuVoltar = { reply_markup: { inline_keyboard: [ [{ text: '🔙 Voltar ao menu', callback_data: 'voltar_menu' }] ] } };

const botoesPrincipais = { reply_markup: { inline_keyboard: [ [ { text: '➕ Incluir saldo', callback_data: 'incluir_saldo' }, { text: '🧾 Incluir despesa', callback_data: 'incluir_despesa' } ], [ { text: '💵 Gasto dinheiro', callback_data: 'gasto_dinheiro' }, { text: '💳 Gasto cartão', callback_data: 'gasto_cartao' }, { text: '🍽️ Gasto SODEXO', callback_data: 'gasto_sodexo' } ], [ { text: '📋 Listar gastos', callback_data: 'listar_gastos' }, { text: '📄 Listar despesas', callback_data: 'listar_despesas' } ], [ { text: '✅ Pagar despesa', callback_data: 'pagar_despesa' } ] ] } };

const enviarParaTodos = (mensagem, opcoes) => { for (const id of data.usuarios) { bot.sendMessage(id, mensagem, opcoes); } };

const resumo = () => { const totalGasto = data.gastos.filter(g => g.tipo === 'dinheiro').reduce((sum, g) => sum + g.valor, 0); const gastosCartao = data.gastos.filter(g => g.tipo === 'cartao').reduce((sum, g) => sum + g.valor, 0); const gastosSodexo = data.gastos.filter(g => g.tipo === 'sodexo').reduce((sum, g) => sum + g.valor, 0);

return Resumo atual:\nSaldo: R$ ${data.saldo.toFixed(2)}\nGasto em dinheiro/débito: R$ ${totalGasto.toFixed(2)}\nGasto no cartão: R$ ${gastosCartao.toFixed(2)}\nGasto no SODEXO: R$ ${gastosSodexo.toFixed(2)}; };

const resumoDespesas = () => { if (data.despesasFixas.length === 0) return 'Nenhuma despesa cadastrada.'; return data.despesasFixas.map((d, i) => ${i + 1}. ${d.nome} - R$ ${d.valor.toFixed(2)} - ${d.pago ? '✅ Pago' : '❌ Pendente'} ).join('\n'); };

bot.setWebHook('https://bottelegram-q3d6.onrender.com/bot' + token);

app.post('/bot' + token, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });

bot.onText(//start/, (msg) => { const chatId = msg.chat.id; if (!data.usuarios.includes(chatId)) { data.usuarios.push(chatId); salvar(); } bot.sendMessage(chatId, 'Escolha uma opção:', botoesPrincipais); });

bot.on('callback_query', (query) => { const chatId = query.message.chat.id; const tipo = query.data;

if (!data.usuarios.includes(chatId)) { data.usuarios.push(chatId); salvar(); }

const pedirInput = (pergunta, callback) => { bot.sendMessage(chatId, pergunta); bot.once('message', callback); };

switch (tipo) { case 'voltar_menu': bot.sendMessage(chatId, 'Escolha uma opção:', botoesPrincipais); break;

case 'incluir_saldo':
  pedirInput('Digite a descrição e o valor (ex: Salário, 1500):', (msg) => {
    const partes = msg.text.split(',').map(p => p.trim());
    const valor = parseFloat(partes.pop().replace(',', '.'));
    const nome = partes.join(' ').trim();
    if (!isNaN(valor)) {
      data.saldo += valor;
      salvar();
      enviarParaTodos(`Saldo adicionado: ${nome} - R$ ${valor.toFixed(2)}\n\n${resumo()}`, menuVoltar);
    } else {
      bot.sendMessage(chatId, 'Valor inválido.', menuVoltar);
    }
  });
  break;

case 'incluir_despesa':
  pedirInput('Digite a descrição e o valor da despesa (ex: Luz, 150):', (msg) => {
    const partes = msg.text.split(',').map(p => p.trim());
    const valor = parseFloat(partes.pop().replace(',', '.'));
    const nome = partes.join(' ').trim();
    if (nome && !isNaN(valor)) {
      data.despesasFixas.push({ nome, valor, pago: false });
      salvar();
      enviarParaTodos(`Despesa registrada: ${nome} - R$ ${valor.toFixed(2)}\n\n${resumoDespesas()}`, menuVoltar);
    } else {
      bot.sendMessage(chatId, 'Formato inválido. Use: Nome, valor', menuVoltar);
    }
  });
  break;

case 'gasto_dinheiro':
case 'gasto_cartao':
case 'gasto_sodexo':
  pedirInput('Digite os gastos (um por linha, ex: Uber, 30):', (msg) => {
    const linhas = msg.text.split('\n');
    const tipoGasto = tipo.split('_')[1];
    let texto = '';

    for (let linha of linhas) {
      const partes = linha.trim().split(',').map(p => p.trim());
      const valor = parseFloat(partes.pop().replace(',', '.'));
      const nome = partes.join(' ').trim();
      if (nome && !isNaN(valor)) {
        data.gastos.push({ nome, valor, tipo: tipoGasto });
        if (tipoGasto === 'dinheiro') data.saldo -= valor;
        texto += `${nome} - R$ ${valor.toFixed(2)}\n`;
      }
    }

    salvar();
    if (texto) {
      enviarParaTodos(`Gastos registrados:\n${texto}\n${resumo()}`, menuVoltar);
    } else {
      bot.sendMessage(chatId, 'Nenhum gasto válido foi informado. Use: Nome, valor', menuVoltar);
    }
  });
  break;

case 'listar_gastos':
  if (data.gastos.length === 0) {
    bot.sendMessage(chatId, 'Nenhum gasto registrado.', menuVoltar);
  } else {
    const lista = data.gastos.map((g, i) => `${i + 1}. ${g.nome} - R$ ${g.valor.toFixed(2)} (${g.tipo})`).join('\n');
    bot.sendMessage(chatId, lista, menuVoltar);
  }
  break;

case 'listar_despesas':
  bot.sendMessage(chatId, resumoDespesas(), menuVoltar);
  break;

case 'pagar_despesa':
  const pendentes = data.despesasFixas.filter(d => !d.pago);
  if (pendentes.length === 0) {
    bot.sendMessage(chatId, 'Nenhuma despesa pendente.', menuVoltar);
  } else {
    const botoes = pendentes.map((d, i) => [{
      text: `${d.nome} - R$ ${d.valor.toFixed(2)}`,
      callback_data: `pagar_${i}`
    }]);
    bot.sendMessage(chatId, 'Escolha uma despesa para marcar como paga:', {
      reply_markup: { inline_keyboard: botoes }
    });
  }
  break;

default:
  if (tipo.startsWith('pagar_')) {
    const index = parseInt(tipo.split('_')[1]);
    if (!isNaN(index) && data.despesasFixas[index] && !data.despesasFixas[index].pago) {
      const despesa = data.despesasFixas[index];
      data.despesasFixas[index].pago = true;
      data.saldo -= despesa.valor;
      salvar();
      enviarParaTodos(`Despesa paga: ${despesa.nome} - R$ ${despesa.valor.toFixed(2)}\n\n${resumo()}`, menuVoltar);
    } else {
      bot.sendMessage(chatId, 'Despesa inválida ou já paga.', menuVoltar);
    }
  }
  break;

} });

app.listen(process.env.PORT || 3000, () => { console.log('Servidor rodando...'); });

