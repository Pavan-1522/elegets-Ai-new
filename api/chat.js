export const config = {
  runtime: 'edge', // Enables streaming
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { message, history } = await req.json();
    const apiKey = process.env.OPENROUTER_API_KEY;

    // 1. Prepare messages
    // We filter out the old 'system' messages from local storage to avoid duplication
    // and inject a fresh, authoritative System Prompt.
    const messages = [
      {
        role: "system",
        content: "You are Elegets AI, a helpful, professional, and intelligent assistant created by Elegets Electronics. You specialize in IoT, coding, and electronics. Answer concisely and accurately."
      },
      ...history.filter(msg => msg.role !== 'system').map(msg => ({
        role: msg.role === 'bot' ? 'assistant' : msg.role, // Map 'bot' to 'assistant' for API
        content: msg.content
      })),
      { role: "user", content: message } // The newest message
    ];

    // 2. Call OpenRouter
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://elegets.com",
        "X-Title": "Elegets AI",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free", // Best free model
        messages: messages,
        stream: true, 
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(`API Error: ${err}`, { status: 500 });
    }

    // 3. Process the Stream (Server-Side)
    // We read OpenRouter's "data: {...}" format and convert it to raw text for your frontend
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
          buffer = lines.pop(); // Keep incomplete lines in buffer

          for (const line of lines) {
            if (line.trim() === 'data: [DONE]') continue;
            if (line.startsWith('data: ')) {
              try {
                const json = JSON.parse(line.substring(6));
                const content = json.choices[0]?.delta?.content || "";
                if (content) {
                  controller.enqueue(encoder.encode(content));
                }
              } catch (e) {
                // Ignore parse errors from partial chunks
              }
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
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}