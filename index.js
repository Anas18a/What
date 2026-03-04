const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const axios = require("axios");

// ===== إعدادات البوت =====
const OPENROUTER_API_KEY = "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"; // ضع مفتاح OpenRouter هنا
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-chat"; // غيّر النموذج كما تشاء
const BOT_NAME = "أنس | المساعد الشخصي";

// ===== أمثلة على النماذج المتاحة =====
// "deepseek/deepseek-chat"
// "google/gemini-2.0-flash-001"
// "openai/gpt-4o"
// "anthropic/claude-3.5-sonnet"
// "meta-llama/llama-3.3-70b-instruct"
// قائمة كاملة: https://openrouter.ai/models

// شخصية البوت - عدّل كما تشاء
const SYSTEM_PROMPT = `اسمك أنس، مساعد شخصي ذكي ومخلص.
تتحدث باللغة العربية بشكل أساسي، بأسلوب ودود ومريح كأنك صديق مقرب.
أجب بدقة واحترافية، وكن مختصرًا وعمليًا في ردودك.
عندما يسألك أحد عن اسمك أو هويتك، قل: أنا أنس، مساعدك الشخصي! 😊`;

// ===== إدارة المحادثات =====
const conversations = new Map();
const MAX_HISTORY = 25;
const recentBotReplies = new Set(); // لتتبع ردود البوت ومنع الدوامة

function getHistory(chatId) {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }
  return conversations.get(chatId);
}

function addToHistory(chatId, role, content) {
  const history = getHistory(chatId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, 2);
  }
}

function clearHistory(chatId) {
  conversations.delete(chatId);
}

// ===== الاتصال بـ OpenRouter =====
async function askOpenRouter(chatId, userMessage) {
  addToHistory(chatId, "user", userMessage);
  const history = getHistory(chatId);

  try {
    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
        temperature: 0.7,
        max_tokens: 1000,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://whatsapp-bot.local",
          "X-Title": "WhatsApp AI Bot",
        },
        timeout: 30000,
      }
    );

    const reply = response.data.choices[0].message.content;
    addToHistory(chatId, "assistant", reply);
    return reply;
  } catch (error) {
    console.error("خطأ في OpenRouter:", error.response?.data || error.message);
    if (error.response?.status === 401) {
      return "❌ خطأ: مفتاح API غير صحيح. تحقق من OPENROUTER_API_KEY.";
    } else if (error.response?.status === 402) {
      return "💳 رصيدك في OpenRouter غير كافٍ. أضف رصيدًا من openrouter.ai.";
    } else if (error.code === "ETIMEDOUT") {
      return "⏱️ انتهت مهلة الطلب. حاول مرة أخرى.";
    }
    return "⚠️ حدث خطأ أثناء معالجة طلبك. حاول مرة أخرى.";
  }
}

// ===== إنشاء عميل واتساب =====
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "openrouter-bot" }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  },
});

// ===== أحداث واتساب =====
client.on("qr", (qr) => {
  console.log("\n📱 امسح هذا الكود بواتساب:\n");
  qrcode.generate(qr, { small: true });
  console.log("\n⏳ في انتظار المسح...\n");
});

client.on("authenticated", () => {
  console.log("✅ تم التوثيق بنجاح!");
});

client.on("auth_failure", (msg) => {
  console.error("❌ فشل التوثيق:", msg);
});

client.on("ready", () => {
  console.log(`\n🤖 ${BOT_NAME} جاهز لخدمتك!`);
  console.log(`🧠 النموذج المستخدم: ${MODEL}\n`);
});

client.on("disconnected", (reason) => {
  console.log("🔌 انقطع الاتصال:", reason);
});

// ===== معالجة الرسائل =====
// message_create يستقبل رسائلك الخاصة أيضاً (fromMe)
client.on("message_create", async (msg) => {
  // تجاهل: المجموعات، ردود البوت التلقائية، والرسائل القديمة
  if (msg.isGroupMsg || msg.timestamp < Date.now() / 1000 - 60) return;

  // إذا كانت الرسالة منك (fromMe)، تأكد أنها ليست رداً تلقائياً من البوت
  // البوت يرد دائماً باستخدام msg.reply() لذا id.id يحتوي على "true_"
  if (msg.fromMe && msg.id.id.startsWith("true_")) return;

  const chatId = msg.from;
  const text = msg.body.trim();

  console.log(`📨 رسالة من ${chatId}: ${text}`);

  // تجاهل أي رسالة لا تبدأ بـ / (البوت يستجيب للأوامر فقط)
  if (!text.startsWith("/")) return;

  // أوامر خاصة

  // أمر /ai — إرسال سؤال مباشر للذكاء الاصطناعي
  if (text.startsWith("/ai ") || text.startsWith("/AI ")) {
    const question = text.slice(4).trim();
    if (!question) {
      await msg.reply("⚠️ يرجى كتابة سؤال بعد الأمر.\nمثال: /ai ما هو الذكاء الاصطناعي؟");
      return;
    }
    const chat = await msg.getChat();
    await chat.sendStateTyping();
    try {
      const reply = await askOpenRouter(chatId, question);
      recentBotReplies.add(reply);
      setTimeout(() => recentBotReplies.delete(reply), 5000);
      await msg.reply(`🤖 *AI:*\n${reply}`);
      console.log(`✉️ [/ai] رد على ${chatId}: ${reply.substring(0, 50)}...`);
    } catch (error) {
      await msg.reply("⚠️ حدث خطأ. حاول مرة أخرى.");
    }
    return;
  }

  if (text === "/مسح" || text === "/clear" || text === "/reset") {
    clearHistory(chatId);
    await msg.reply("🗑️ تم مسح سجل المحادثة. ابدأ محادثة جديدة!");
    return;
  }

  if (text === "/نموذج" || text === "/model") {
    await msg.reply(`🧠 النموذج الحالي: *${MODEL}*\nيمكن تغييره من ملف index.js`);
    return;
  }

  if (text === "/مساعدة" || text === "/help") {
    const helpMsg = `🤖 *${BOT_NAME}*\n\n` +
      `أنا أنس، مساعدك الشخصي الذكي! كيف يمكنني مساعدتك؟ 😊\n\n` +
      `📋 *الأوامر المتاحة:*\n` +
      `• /ai [سؤال] — إرسال سؤال مباشر للذكاء الاصطناعي\n` +
      `• /مسح أو /clear — مسح سجل المحادثة\n` +
      `• /نموذج أو /model — عرض النموذج الحالي\n` +
      `• /مساعدة أو /help — عرض هذه القائمة\n\n` +
      `💬 فقط اكتب أي سؤال وسأجيبك!`;
    await msg.reply(helpMsg);
    return;
  }

  // تجاهل إذا كان النص هو رد سابق من البوت (حماية من الدوامة)
  if (recentBotReplies.has(text)) return;

  const chat = await msg.getChat();
  await chat.sendStateTyping();

  try {
    const reply = await askOpenRouter(chatId, text);

    // حفظ الرد مؤقتاً لمنع معالجته مجدداً (5 ثواني)
    recentBotReplies.add(reply);
    setTimeout(() => recentBotReplies.delete(reply), 5000);

    await msg.reply(reply);
    console.log(`✉️ رد على ${chatId}: ${reply.substring(0, 50)}...`);
  } catch (error) {
    console.error("خطأ في معالجة الرسالة:", error);
    await msg.reply("⚠️ حدث خطأ. حاول مرة أخرى.");
  }
});

// ===== HTTP Server لمنع النوم على Render =====
const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("🤖 البوت شغال!");
}).listen(PORT, () => {
  console.log(`🌐 HTTP Server يعمل على port ${PORT}`);
});

// ===== تشغيل البوت =====
console.log(`🚀 جارٍ تشغيل ${BOT_NAME}...`);
client.initialize();
