import 'dotenv/config';

import { getTools, type ToolBase } from '@goat-sdk/core';
import { rugcheck } from '@goat-sdk/plugin-rugcheck';
import { Agent, type Capability } from '@openserv-labs/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createWalletClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { viem } from '@goat-sdk/wallet-viem';

if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
}

if (!process.env.OPENSERV_API_KEY) {
    throw new Error('OPENSERV_API_KEY is not set');
}

if (!process.env.RPC_PROVIDER_URL) {
    throw new Error('RPC_PROVIDER_URL is not set');
}

const systemPrompt = `
You are a security-focused AI agent specializing in detecting potential rug pulls in the cryptocurrency space. 
You use the RugCheck service to analyze tokens and provide users with information about their risk level.

Here's how you operate:

1. **Understand the User's Request:** Determine if the user is asking about:
    - Recently detected tokens
    - Trending tokens (last 24 hours)
    - Most voted tokens (last 24 hours)
    - Recently verified tokens
    - A specific token's risk (requires a token mint address)

2. **Use the Correct Tool:** Based on the user's request, select the appropriate RugCheck tool.  Be precise:
    - If they ask for "newly detected" tokens, use "get_recently_detected_tokens".
    - If they ask for "trending" tokens, use "get_trending_tokens_last_24_hours".
    - If they ask about "most voted" tokens, use "get_most_voted_tokens_last_24_hours".
    - If they ask about "verified" tokens, use "get_recently_verified_tokens".
    - If they provide a token mint address (a long string of characters) and ask about the token, use "generate_token_report_summary".

3. **Provide Clear and Concise Information:** Present the results from RugCheck in a user-friendly format.  
    - For lists of tokens (trending, detected, etc.), list the tokens clearly.
    - For a token report, summarize the key findings (risk level, warnings, etc.).


5. **Handle Errors Gracefully**: If you encounter an error, say "An error occurred while processing your request. Please check parameters".

Example Interactions:

User: "What are the recently detected tokens?"
You: (Use the "get_recently_detected_tokens" tool and present the results)

User: "Is token mint address '...' a rug pull?"
You: (Use the "generate_token_report_summary" tool with the provided mint address and present a summary)

User: "What are the trending tokens?"
You: (Use the "get_trending_tokens_last_24_hours" tool.)

User: "What are the most trust voted tokens?"
You: (Use the "get_most_voted_tokens_last_24_hours" tool)
`;

const goatAgent = new Agent({
    systemPrompt,
});

const toCapability = (tool: ToolBase) => {
    // Create a mapping for names that need to be changed
    const nameMap: Record<string, string> = {
        'rugcheck.get_recently_detected_tokens': 'get_recently_detected_tokens',
        'rugcheck.get_trending_tokens_24h': 'get_trending_tokens_last_24_hours',
        'rugcheck.get_most_voted_tokens_24h': 'get_most_voted_tokens_last_24_hours',
        'rugcheck.get_recently_verified_tokens': 'get_recently_verified_tokens',
        'rugcheck.generate_token_report_summary': 'generate_token_report_summary',
    };

    const capabilityName = nameMap[tool.name] || tool.name; // Use mapped name or original

    return {
        name: capabilityName,
        description: tool.description,
        schema: tool.parameters,
        async run({ args }) {
            try {
                const response = await tool.execute(args);
                if (typeof response === 'object') {
                    return JSON.stringify(response, null, 2);
                }
                return response.toString();
            } catch (error) {
                console.error(`Error in capability ${tool.name}:`, error);
                return `An error occurred while running ${tool.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
        },
    } as Capability<typeof tool.parameters>;
};

async function main() {
    const dummyWalletClient = createWalletClient({
        chain: mainnet,
        transport: http(process.env.RPC_PROVIDER_URL),
    });

    const wallet = viem(dummyWalletClient);

    const allTools = await getTools({
        wallet,
        plugins: [rugcheck()],
    });


    // Filter out the unwanted wallet tools.
    const tools = allTools.filter(tool => tool.name.startsWith('rugcheck.'));


    const capabilities = tools.map(toCapability)

    try {


        await goatAgent.addCapabilities(capabilities as [
            Capability<z.ZodTypeAny>,
            ...Capability<z.ZodTypeAny>[]
        ]);
        await goatAgent.start();
    } catch (error) {
        console.error(error);
    }
}

main();
