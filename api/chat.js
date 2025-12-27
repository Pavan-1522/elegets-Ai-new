export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // 1. Check Method
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    // 2. Parse Data
    const { message, history } = await req.json();
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API Key is missing in Vercel Settings' }), { status: 500 });
    }

    // 3. Prepare Messages
    const messages = [
      {
        role: "system",
        content: "You are Elegets AI. Be helpful, concise, and professional."
      },
      ...(history || []).filter(msg => msg.role !== 'system').map(msg => ({
        role: msg.role === 'bot' ? 'assistant' : msg.role,
        content: msg.content
      })),
      { role: "user", content: message }
    ];

    // 4. Call OpenRouter (Using a highly stable model for testing)
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://elegets.com",
        "X-Title": "Elegets AI",
      },
      body: JSON.stringify({
        // Switched to Llama 3 (Free) because it is very stable. 
        // You can change back to 'google/gemini-2.0-flash-exp:free' later.
        model: "google/gemini-2.0-flash-exp:free", 
        messages: messages,
        stream: true, 
      }),
    });

    // 5. Catch API Errors
    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: `OpenRouter API Error: ${errorText}` }), { status: response.status });
    }

    // 6. Stream the Response
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop(); 

          for (const line of lines) {
            if (line.trim() === 'data: [DONE]') continue;
            if (line.startsWith('data: ')) {
              try {
                const json = JSON.parse(line.substring(6));
                const content = json.choices[0]?.delta?.content || "";
                if (content) controller.enqueue(encoder.encode(content));
              } catch (e) {}
            }
          }
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: `Backend Crash: ${error.message}` }), { status: 500 });
  }
}