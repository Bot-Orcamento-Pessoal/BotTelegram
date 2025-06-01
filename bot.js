const TelegramBot = require('node-telegram-bot-api');
const moment = require('moment');
moment.locale('pt-br');

const fs = require('fs');
const path = require('path');
const token = process.env.BOT_TOKEN;
const express = require('express');
const bodyParser = require('body-parser');
const app = express();

app.use(bodyParser.json());

app.post(/bot${token}, (req, res) => {
bot.processUpdate(req.body);
res.sendStatus(200);
});

// Coloque o restante do seu código aqui (gastos, handlers etc.)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(Bot rodando na porta ${PORT});
});

const bot = new TelegramBot(token, { webHook: true });
bot.setWebHook(https://bottelegram-q3d6.onrender.com/bot${token});

let saldo = 0;
let gastos = [];
let despesasFixas = [];

const menuPrincipal = {
reply_markup: {
inline_keyboard: [
[
{ text: '➕ Incluir saldo', callback_data: 'incluir_saldo' },
{ text: '➕ Incluir despesa', callback_data: 'incluir_despesa' }
],
[
{ text: '💸 Gasto dinheiro/débito', callback_data: 'gasto_dinheiro' },
{ text: '💳 Gasto cartão', callback_data: 'gasto_cartao' }
],
[
{ text: '🍽️ Gasto SODEXO', callback_data: 'gasto_sodexo' },
{ text: '📋 Listar gastos', callback_data: 'listar_gastos' }
],
[
{ text: '📑 Listar despesas', callback_data: 'listar_despesas' },
{ text: '💸 Pagar despesa', callback_data: 'pagar_despesa' }
]
]
}
};

function enviarResumo(chatId) {
const gastosMes = gastos.filter(g => moment(g.data).isSame(moment(), 'month'));
const totalDinheiro = gastosMes.filter(g => g.tipo === 'dinheiro').reduce((acc, g) => acc + g.valor, 0);
const totalCartao = gastosMes.filter(g => g.tipo === 'cartao').reduce((acc, g) => acc + g.valor, 0);
const totalSodexo = gastosMes.filter(g => g.tipo === 'sodexo').reduce((acc, g) => acc + g.valor, 0);
const totalDespesasPagas = despesasFixas.filter(d => d.status === 'pago').reduce((acc, d) => acc + d.valor, 0);
const saldoAtual = saldo - totalDinheiro - totalDespesasPagas;

const resumo = Resumo do mês de ${moment().format('MMMM')}:\n\n +
Saldo atual: R$ ${saldoAtual.toFixed(2)}\n +
Gastos Dinheiro/Débito: R$ ${totalDinheiro.toFixed(2)}\n +
Gastos Cartão: R$ ${totalCartao.toFixed(2)}\n +
Gastos SODEXO: R$ ${totalSodexo.toFixed(2)}\n +
Despesas pagas: R$ ${totalDespesasPagas.toFixed(2)};

bot.sendMessage(chatId, resumo, {
reply_markup: {
inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'menu' }]]
}
});
}

bot.onText(//start/, msg => {
bot.sendMessage(msg.chat.id, 'Bem-vindo ao bot de orçamento!', menuPrincipal);
});

bot.on('callback_query', query => {
const chatId = query.message.chat.id;
const data = query.data;

if (data === 'incluir_despesa') {
bot.sendMessage(chatId, 'Envie a despesa no formato: descrição, valor');
bot.once('message', msg => {
const partes = msg.text.split(',');
const descricao = partes[0]?.trim();
const valor = parseFloat(partes[1]);
if (descricao && !isNaN(valor)) {
despesasFixas.push({ descricao, valor, status: 'pendente' });
bot.sendMessage(chatId, Despesa "${descricao}" adicionada como pendente.);
enviarResumo(chatId);
} else {
bot.sendMessage(chatId, 'Formato inválido. Use: descrição, valor');
}
});
}

if (data === 'incluir_saldo') {
bot.sendMessage(chatId, 'Envie o saldo no formato: valor ou descrição, valor');
bot.once('message', msg => {
const partes = msg.text.split(',');
const valor = parseFloat(partes.length === 1 ? partes[0] : partes[1]);
if (!isNaN(valor)) {
saldo += valor;
enviarResumo(chatId);
} else {
bot.sendMessage(chatId, 'Valor inválido.');
}
});
}

if (['gasto_dinheiro', 'gasto_cartao', 'gasto_sodexo'].includes(data)) {
const tipo = data.replace('gasto_', '');
bot.sendMessage(chatId, 'Envie os gastos no formato: descrição, valor, data (opcional). Pode enviar vários por linha.\nEx: mercado, 50, 10/05');
bot.once('message', msg => {
const linhas = msg.text.split('\n');
linhas.forEach(linha => {
const partes = linha.split(',');
const descricao = partes[0]?.trim();
const valor = parseFloat(partes[1]);
const dataInformada = partes[2] ? moment(partes[2].trim(), 'DD/MM', true) : moment();

if (descricao && !isNaN(valor) && dataInformada.isValid()) {
gastos.push({ descricao, valor, tipo, data: dataInformada.format() });
if (tipo === 'dinheiro') saldo -= valor;
}
});
enviarResumo(chatId);
});
}

if (data === 'listar_gastos') {
if (gastos.length === 0) {
bot.sendMessage(chatId, 'Nenhum gasto registrado.');
return;
}
const lista = gastos.map((g, i) =>
${i + 1}. ${g.descricao} - R$ ${g.valor.toFixed(2)} - ${g.tipo} - ${moment(g.data).format('DD/MM')}
).join('\n');
bot.sendMessage(chatId, Gastos:\n${lista}, {
reply_markup: {
inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'menu' }]]
}
});
}

if (data === 'listar_despesas') {
if (despesasFixas.length === 0) {
bot.sendMessage(chatId, 'Nenhuma despesa fixa registrada.');
return;
}
const lista = despesasFixas.map((d, i) =>
${i + 1}. ${d.descricao} - R$ ${d.valor.toFixed(2)} - ${d.status}
).join('\n');
bot.sendMessage(chatId, Despesas Fixas:\n${lista}, {
reply_markup: {
inline_keyboard: [[{ text: '⬅️ Voltar ao menu', callback_data: 'menu' }]]
}
});
}

if (data === 'pagar_despesa') {
const pendentes = despesasFixas.filter(d => d.status === 'pendente');
if (pendentes.length === 0) {
bot.sendMessage(chatId, 'Nenhuma despesa pendente.');
return;
}
const botoes = pendentes.map((d, i) => [{ text: ${d.descricao} - R$ ${d.valor.toFixed(2)}, callback_data: pagar_${i} }]);
bot.sendMessage(chatId, 'Escolha a despesa para pagar:', {
reply_markup: { inline_keyboard: botoes }
});
}

if (data.startsWith('pagar_')) {
const index = parseInt(data.replace('pagar_', ''));
if (!isNaN(index) && despesasFixas[index] && despesasFixas[index].status === 'pendente') {
despesasFixas[index].status = 'pago';
saldo -= despesasFixas[index].valor;
bot.sendMessage(chatId, Despesa "${despesasFixas[index].descricao}" marcada como paga.);
enviarResumo(chatId);
}
}

if (data === 'menu') {
bot.sendMessage(chatId, 'Menu principal:', menuPrincipal);
}
});

bot.onText(//despesa (.+)/, (msg, match) => {
const [descricao, valorStr] = match[1].split(',');
const valor = parseFloat(valorStr);
if (!descricao || isNaN(valor)) {
bot.sendMessage(msg.chat.id, 'Formato inválido. Use: /despesa aluguel, 500');
return;
}
despesasFixas.push({ descricao: descricao.trim(), valor, status: 'pendente' });
bot.sendMessage(msg.chat.id, Despesa "${descricao.trim()}" adicionada como pendente.);
});

bot.onText(//exportar/, (msg) => {
const chatId = msg.chat.id;

let csv = 'GASTOS\nDescrição,Valor,Tipo,Data\n';
gastos.forEach(g => {
csv += "${g.descricao}",${g.valor},"${g.tipo}","${moment(g.data).format('DD/MM/YYYY HH:mm')}"\n;
});

csv += '\nDESPESAS FIXAS\nDescrição,Valor,Status\n';
despesasFixas.forEach(d => {
csv += "${d.descricao}",${d.valor},"${d.status}"\n;
});

csv += \nSALDO ATUAL\n${saldo.toFixed(2)}\n;

const filePath = path.join(__dirname, 'backup.csv');
fs.writeFileSync(filePath, csv, 'utf8');

bot.sendDocument(chatId, filePath, {}, {
filename: 'backup_orcamento.csv',
contentType: 'text/csv'
});
});

bot.onText(//importar/, (msg) => {
const chatId = msg.chat.id;
bot.sendMessage(chatId, 'Envie o arquivo CSV do backup.');

bot.once('document', async (docMsg) => {
const fileId = docMsg.document.file_id;
const fileLink = await bot.getFileLink(fileId);

const https = require('https');  
https.get(fileLink, (res) => {  
  let data = '';  
  res.on('data', chunk => data += chunk);  
  res.on('end', () => {  
    try {  
      const linhas = data.split('\n').map(l => l.trim()).filter(l => l);  
      let secao = '';  
      gastos = [];  
      despesasFixas = [];  
      saldo = 0;  

      linhas.forEach(linha => {  
        if (linha === 'GASTOS') {  
          secao = 'gastos';  
        } else if (linha === 'DESPESAS FIXAS') {  
          secao = 'despesas';  
        } else if (linha === 'SALDO ATUAL') {  
          secao = 'saldo';  
        } else if (!linha.startsWith('Descrição')) {  
          const partes = linha.split(',');  
          if (secao === 'gastos' && partes.length >= 4) {  
            const descricao = partes[0].replace(/"/g, '').trim();  
            const valor = parseFloat(partes[1]);  
            const tipo = partes[2].replace(/"/g, '').trim();  
            const data = moment(partes[3].replace(/"/g, '').trim(), 'DD/MM/YYYY HH:mm');  
            if (!isNaN(valor) && data.isValid()) {  
              gastos.push({ descricao, valor, tipo, data: data.format() });  
            }  
          } else if (secao === 'despesas' && partes.length >= 3) {  
            const descricao = partes[0].replace(/"/g, '').trim();  
            const valor = parseFloat(partes[1]);  
            const status = partes[2].replace(/"/g, '').trim();  
            if (!isNaN(valor)) {  
              despesasFixas.push({ descricao, valor, status });  
            }  
          } else if (secao === 'saldo' && partes.length >= 1) {  
            const valor = parseFloat(partes[0]);  
            if (!isNaN(valor)) {  
              saldo = valor;  
            }  
          }  
        }  
      });  

      bot.sendMessage(chatId, 'Backup importado com sucesso!');  
      enviarResumo(chatId);  
    } catch (e) {  
      console.error(e);  
      bot.sendMessage(chatId, 'Erro ao importar o backup.');  
    }  
  });  
});

});
});

bot.onText(//ajuda/, msg => {
const comandos = `
Comandos disponíveis:
/start - Iniciar o bot
/ajuda - Ver os comandos
/despesa descrição, valor - Adicionar despesa fixa
/exportar - Exportar backup em CSV
/importar - Importar backup em CSV

Use os botões para:

Incluir saldo

Incluir despesa

Adicionar gastos (dinheiro, cartão, SODEXO)

Listar gastos

Listar despesas

Pagar despesas fixas


Os valores devem ser enviados no formato:
descrição, valor
Ou para gastos também pode incluir a data:
descrição, valor, data (opcional, no formato DD/MM)
`;
bot.sendMessage(msg.chat.id, comandos);
});
