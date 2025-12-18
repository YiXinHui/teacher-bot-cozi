// 文件路径: api/coze.js
// 专为扣子 Coze V3 API 设计的中转桥
// 自动处理：发起对话 -> 等待思考 -> 获取回复

export default async function handler(req, res) {
    // 1. 设置跨域头
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { token, botId, message, userId } = req.body;

    if (!token || !botId || !message) {
        return res.status(400).json({ success: false, error: '缺少参数' });
    }

    const COZE_API_BASE = 'https://api.coze.cn/v3';

    try {
        console.log("1. 正向扣子发起对话...");
        
        // 第一步：发起对话 (Chat)
        const chatResponse = await fetch(`${COZE_API_BASE}/chat`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                bot_id: botId,
                user_id: userId || 'user_001',
                stream: false, // 咱们用非流式，简单稳定
                auto_save_history: true,
                additional_messages: [
                    {
                        role: 'user',
                        content: message,
                        content_type: 'text'
                    }
                ]
            })
        });

        const chatData = await chatResponse.json();
        
        if (chatData.code !== 0 || !chatData.data) {
            throw new Error(`发起对话失败: ${chatData.msg || JSON.stringify(chatData)}`);
        }

        const { conversation_id, id: chat_id } = chatData.data;
        console.log(`2. 对话创建成功 (ChatID: ${chat_id})，开始轮询状态...`);

        // 第二步：轮询状态 (Check Status)
        // 扣子 V3 需要等待它思考完成，Vercel 免费版限制 10秒，我们最多轮询 8秒
        let status = 'created';
        let retries = 0;
        
        while (status !== 'completed' && retries < 8) {
            await new Promise(r => setTimeout(r, 1000)); // 等1秒
            
            const checkRes = await fetch(`${COZE_API_BASE}/chat/retrieve?conversation_id=${conversation_id}&chat_id=${chat_id}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const checkData = await checkRes.json();
            
            if (checkData.data) {
                status = checkData.data.status;
                console.log(`...状态: ${status}`);
                if (status === 'failed' || status === 'canceled') {
                    throw new Error('扣子处理失败或被取消');
                }
            }
            retries++;
        }

        if (status !== 'completed') {
            throw new Error('扣子思考超时，请重试');
        }

        // 第三步：获取消息列表 (Get Messages)
        console.log("3. 思考完成，获取回复内容...");
        const msgRes = await fetch(`${COZE_API_BASE}/chat/message/list?conversation_id=${conversation_id}&chat_id=${chat_id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const msgData = await msgRes.json();

        // 筛选出 AI 的回答
        // 通常找 role=assistant 且 type=answer 的消息
        const aiMsg = msgData.data.find(m => m.role === 'assistant' && m.type === 'answer');

        if (aiMsg) {
            return res.status(200).json({ success: true, reply: aiMsg.content });
        } else {
            return res.status(500).json({ success: false, error: '未找到AI回复' });
        }

    } catch (error) {
        console.error('Coze API Error:', error);
        return res.status(500).json({ success: false, error: '连接失败: ' + error.message });
    }
}
