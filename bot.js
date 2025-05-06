const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const token = '7978120569:AAFH8TqHqXelm0SFiK6iNHhkwIHS0eE64_c'; // Substitua pelo seu token real

const bot = new TelegramBot(token, { polling: true });

let data = {
  saldo: 0,
  gastos: [],
  despesasFixas: []
};

const salvar = () => {
  fs.writeFileSync('not.json', JSON.stringify(data, null, 2));
};

const carregar = () => {
  if (fs.existsSync('not.json')) {
    data = JSON.parse(fs.readFileSync('not.json'));
  }
};

carregar();

const resumo = () => {
  const totalGasto = data.gastos
    .filter(g => g.tipo !== 'cartão' && g.tipo !== 'sodexo')
    .reduce((sum, g) => sum + g.valor, 0);
  const gastosCartao = data.gastos
    .filter(g => g.tipo === 'cartão')
    .reduce((sum, g) => sum + g.valor, 0);
  const gastosSodexo = data.gastos
    .filter(g => g.tipo === 'sodexo')
    .reduce((sum, g) => sum + g.valor, 0);

  return `Resumo atual:
Saldo: R$ ${data.saldo.toFixed(2)}
Gasto em dinheiro/débito: R$ ${totalGasto.toFixed(2)}
Gasto no cartão: R$ ${gastosCartao.toFixed(2)}
Gasto no SODEXO: R$ ${gastosSodexo.toFixed(2)}`;
};

const resumoDespesas = () => {
  if (data.despesasFixas.length === 0) return 'Nenhuma despesa cadastrada.';
  return data.despesasFixas
    .map((d, i) => `${i + 1}. ${d.nome} - R$ ${d.valor.toFixed(2)} - ${d.pago ? '✅ Pago' : '❌ Pendente'}`)
    .join('\n');
};

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Escolha uma opção:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '➕ Incluir saldo', callback_data: 'incluir_saldo' },
          { text: '🧾 Incluir despesa', callback_data: 'incluir_despesa' }
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
  });
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const tipo = query.data;

  switch (tipo) {
    case 'incluir_saldo':
      bot.sendMessage(chatId, 'Digite o valor a ser adicionado:');
      bot.once('message', (msg) => {
        const valor = parseFloat(msg.text.replace(',', '.'));
        if (!isNaN(valor)) {
          data.saldo += valor;
          salvar();
          bot.sendMessage(chatId, `Saldo atualizado!\n\n${resumo()}`);
        } else {
          bot.sendMessage(chatId, 'Valor inválido.');
        }
      });
      break;

    case 'incluir_despesa':
      bot.sendMessage(chatId, 'Digite a descrição e o valor da despesa (ex: Luz 150):');
      bot.once('message', (msg) => {
        const partes = msg.text.split(' ');
        const valor = parseFloat(partes.pop().replace(',', '.'));
        const nome = partes.join(' ');
        if (nome && !isNaN(valor)) {
          data.despesasFixas.push({ nome, valor, pago: false });
          salvar();
          bot.sendMessage(chatId, 'Despesa registrada.');
        } else {
          bot.sendMessage(chatId, 'Formato inválido.');
        }
      });
      break;

    case 'gasto_dinheiro':
    case 'gasto_cartao':
    case 'gasto_sodexo':
      bot.sendMessage(chatId, 'Digite a descrição e o valor do gasto (ex: Uber 30):');
      bot.once('message', (msg) => {
        const partes = msg.text.split(' ');
        const valor = parseFloat(partes.pop().replace(',', '.'));
        const nome = partes.join(' ');
        if (nome && !isNaN(valor)) {
          const tipoGasto = tipo.split('_')[1];
          data.gastos.push({ nome, valor, tipo: tipoGasto });
          if (tipoGasto === 'dinheiro') {
            data.saldo -= valor;
          }
          salvar();
          bot.sendMessage(chatId, `Gasto registrado!\n\n${resumo()}`);
        } else {
          bot.sendMessage(chatId, 'Formato inválido.');
        }
      });
      break;

    case 'listar_gastos':
      if (data.gastos.length === 0) {
        bot.sendMessage(chatId, 'Nenhum gasto registrado.');
      } else {
        const lista = data.gastos
          .map((g, i) => `${i + 1}. ${g.nome} - R$ ${g.valor.toFixed(2)} (${g.tipo})`)
          .join('\n');
        bot.sendMessage(chatId, lista);
      }
      break;

    case 'listar_despesas':
      bot.sendMessage(chatId, resumoDespesas());
      break;

    case 'pagar_despesa':
      const pendentes = data.despesasFixas.filter(d => !d.pago);
      if (pendentes.length === 0) {
        bot.sendMessage(chatId, 'Nenhuma despesa pendente.');
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
          bot.sendMessage(chatId, `Despesa "${despesa.nome}" marcada como paga.\n\n${resumoDespesas()}`);
        } else {
          bot.sendMessage(chatId, 'Despesa inválida ou já paga.');
        }
      }
      break;
  }
});
