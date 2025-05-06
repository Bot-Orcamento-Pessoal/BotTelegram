const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);
const app = express();
app.use(express.json());

const url = process.env.RENDER_EXTERNAL_URL;
const port = process.env.PORT || 3000;

bot.setWebHook(`${url}/bot${token}`);

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

let saldo = 0;
let gastos = [];
const activeChats = new Set();

const meses = {
  janeiro: '01', fevereiro: '02', março: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
};

const formatarValor = valor => `R$ ${valor.toFixed(2)}`;

const mostrarMenu = (chatId) => {
  bot.sendMessage(chatId, 'O que deseja fazer?', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Incluir Saldo', callback_data: 'incluir_saldo' }],
        [
          { text: '💵 Gasto Dinheiro/Débito', callback_data: 'gasto_dinheiro' },
          { text: '💳 Gasto Cartão', callback_data: 'gasto_cartao' },
          { text: '🍽️ Gasto SODEXO', callback_data: 'gasto_sodexo' }
        ],
        [{ text: '📋 Listar Gastos', callback_data: 'listar_gastos' }],
        [{ text: '❓ Ajuda', callback_data: 'ajuda' }]
      ]
    }
  });
};

const enviarResumoDetalhado = (chatId) => {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const gastosMes = gastos.filter(g => g.data?.startsWith(`${ano}-${mes}`));

  const totalGasto = gastosMes.filter(g => g.tipo !== 'saldo').reduce((acc, g) => acc + g.valor, 0);
  const gastoDinheiro = gastosMes.filter(g => g.tipo === 'dinheiro').reduce((acc, g) => acc + g.valor, 0);
  const gastoCartao = gastosMes.filter(g => g.tipo === 'cartao').reduce((acc, g) => acc + g.valor, 0);
  const gastoSodexo = gastosMes.filter(g => g.tipo === 'sodexo').reduce((acc, g) => acc + g.valor, 0);

  bot.sendMessage(chatId, `
Resumo do mês:

- Total gasto: ${formatarValor(totalGasto)}
- Saldo atual: ${formatarValor(saldo)}
- Em dinheiro/débito: ${formatarValor(gastoDinheiro)}
- No cartão: ${formatarValor(gastoCartao)}
- Com SODEXO: ${formatarValor(gastoSodexo)}
`.trim()).then(() => mostrarMenu(chatId));
};

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Bem-vindo ao bot de orçamento pessoal!');
  mostrarMenu(msg.chat.id);
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const tipo = query.data;

  if (activeChats.has(chatId)) return;
  activeChats.add(chatId);

  try {
    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    activeChats.delete(chatId);
    return;
  }

  if (['gasto_dinheiro', 'gasto_cartao', 'gasto_sodexo'].includes(tipo)) {
    const tipoNome = {
      gasto_dinheiro: 'dinheiro/débito',
      gasto_cartao: 'cartão',
      gasto_sodexo: 'SODEXO'
    }[tipo];

    bot.sendMessage(chatId, `Digite os gastos (${tipoNome}) no formato: descrição, valor. Pode enviar vários separados por linha.`);

    const listener = (msg) => {
      if (msg.chat.id !== chatId) return;

      const linhas = msg.text.split('\n');
      const tipoGasto = tipo.replace('gasto_', '');
      const data = new Date().toISOString().slice(0, 10);

      linhas.forEach(linha => {
        const partes = linha.split(',');
        if (partes.length !== 2) return;
        const [descricao, valorTexto] = partes;
        const valor = parseFloat(valorTexto);
        if (descricao && !isNaN(valor)) {
          gastos.push({ descricao: descricao.trim(), valor, tipo: tipoGasto, data });
          if (tipoGasto === 'dinheiro') saldo -= valor;
        }
      });

      bot.removeListener('message', listener);
      enviarResumoDetalhado(chatId);
      activeChats.delete(chatId);
    };

    bot.once('message', listener);
  } else if (tipo === 'incluir_saldo') {
    bot.sendMessage(chatId, 'Digite o valor do saldo no formato: descrição, valor');

    const listener = (msg) => {
      if (msg.chat.id !== chatId) return;

      const [descricao, valorTexto] = msg.text.split(',');
      const valor = parseFloat(valorTexto);
      if (!descricao || isNaN(valor)) {
        bot.sendMessage(chatId, 'Formato inválido. Ex: Salário, 2000');
        bot.removeListener('message', listener);
        activeChats.delete(chatId);
        return;
      }

      saldo += valor;
      const data = new Date().toISOString().slice(0, 10);
      gastos.push({ descricao: descricao.trim(), valor, tipo: 'saldo', data });
      bot.removeListener('message', listener);
      enviarResumoDetalhado(chatId);
      activeChats.delete(chatId);
    };

    bot.once('message', listener);
  } else if (tipo === 'listar_gastos') {
    if (gastos.length === 0) return bot.sendMessage(chatId, 'Nenhum gasto registrado ainda.');
    const lista = gastos.map((g, i) => `${i + 1}. ${g.descricao} - ${formatarValor(g.valor)} (${g.tipo}) [${g.data}]`).join('\n');
    bot.sendMessage(chatId, `Seus gastos:\n${lista}`).then(() => mostrarMenu(chatId));
    activeChats.delete(chatId);
  } else if (tipo === 'ajuda') {
    bot.sendMessage(chatId, `
Comandos disponíveis:
/start - Exibir menu
/ajuda - Mostrar comandos

⬇️ SALDO
- ➕ Incluir saldo

⬇️ GASTOS
- 💵 Dinheiro/Débito
- 💳 Cartão
- 🍽️ SODEXO

⬇️ RESUMOS
- /resumo
- /resumo abril
- /resumo maio
- /resumo saldo
- /resumo cartão

⬇️ OUTROS
- 📋 Listar gastos
- /removergasto N
`).then(() => mostrarMenu(chatId));
    activeChats.delete(chatId);
  }
});

bot.onText(/\/resumo(.*)/, (msg, match) => {
  const tipo = match[1].trim().toLowerCase();
  const chatId = msg.chat.id;

  let lista = [];

  if (tipo === 'saldo') {
    return bot.sendMessage(chatId, `Saldo atual: ${formatarValor(saldo)}`).then(() => mostrarMenu(chatId));
  }

  const mesAlvo = meses[tipo];
  const ano = new Date().getFullYear();

  if (mesAlvo) {
    lista = gastos.filter(g => g.data?.startsWith(`${ano}-${mesAlvo}`));
  } else if (['cartão', 'cartao', 'débito', 'debito', 'sodexo', 'dinheiro'].includes(tipo)) {
    const tipoFiltrado = (tipo === 'débito' || tipo === 'debito') ? 'dinheiro' : tipo.replace('ç', 'c');
    lista = gastos.filter(g => g.tipo === tipoFiltrado);
  } else if (tipo) {
    lista = gastos.filter(g => g.descricao.toLowerCase().includes(tipo));
  } else {
    const mes = String(new Date().getMonth() + 1).padStart(2, '0');
    lista = gastos.filter(g => g.data?.startsWith(`${ano}-${mes}`));
  }

  if (lista.length === 0) {
    return bot.sendMessage(chatId, 'Nenhum item encontrado para esse resumo.').then(() => mostrarMenu(chatId));
  }

  const total = lista.reduce((acc, g) => acc + g.valor, 0);
  const texto = lista.map((g, i) => `${i + 1}. ${g.descricao} - ${formatarValor(g.valor)} (${g.tipo}) [${g.data}]`).join('\n');
  bot.sendMessage(chatId, `Resumo (${tipo || 'mês atual'}):\nTotal: ${formatarValor(total)}\n${texto}`).then(() => mostrarMenu(chatId));
});

bot.onText(/\/removergasto (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const index = parseInt(match[1]) - 1;

  if (index < 0 || index >= gastos.length) {
    return bot.sendMessage(chatId, 'Índice inválido.').then(() => mostrarMenu(chatId));
  }

  const removido = gastos.splice(index, 1)[0];
  if (removido.tipo === 'dinheiro') saldo += removido.valor;
  if (removido.tipo === 'saldo') saldo -= removido.valor;

  bot.sendMessage(chatId, `Gasto removido: ${removido.descricao} - ${formatarValor(removido.valor)} (${removido.tipo})`).then(() => enviarResumoDetalhado(chatId));
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
app.get('/', (req, res) => {
  res.send('Bot está online!');
});
