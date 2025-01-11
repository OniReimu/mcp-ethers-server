import { ethers } from "ethers";
import { z } from "zod";

export type DefaultProvider = 
    | "mainnet"      // Ethereum Mainnet
    | "sepolia"      // Sepolia Testnet
    | "goerli"       // Goerli Testnet
    | "arbitrum"     // Arbitrum
    | "optimism"     // Optimism
    | "base"         // Base
    | "polygon";     // Polygon

const DEFAULT_PROVIDERS = [
    "mainnet",
    "sepolia",
    "goerli",
    "arbitrum",
    "optimism",
    "base",
    "polygon"
];

// Move addressSchema to class level to avoid duplication
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export class EthersService {
    private defaultProvider: ethers.Provider;
    private defaultSigner?: ethers.Signer;

    constructor(provider?: ethers.Provider, signer?: ethers.Signer) {
        this.defaultProvider = provider || new ethers.JsonRpcProvider('http://localhost:8545');
        this.defaultSigner = signer;
    }

    private getInfuraApiKey(): string {
        const infuraApiKey = process.env.INFURA_API_KEY;
        if (!infuraApiKey) {
            throw new Error("Missing INFURA_API_KEY in environment variables.");
        }
        return infuraApiKey;
    }

    private createInfuraProvider(network: DefaultProvider): ethers.Provider {
        try {
            return new ethers.InfuraProvider(network as ethers.Networkish, this.getInfuraApiKey());
        } catch (error) {
            this.handleProviderError(error, `create Infura provider for network ${network}`);
        }
    }

    private validateRpcUrl(url: string): void {
        if (!url.match(/^https?:\/\/.+$/)) {
            throw new Error(`Invalid RPC URL format: ${url}. URL must start with http:// or https:// and include a valid domain.`);
        }
    }

    private handleProviderError(error: unknown, context: string, details?: Record<string, any>): never {
        if (error instanceof z.ZodError) {
            const firstError = error.errors[0];
            const message = firstError?.message || 'Invalid input format';
            throw new Error(`Invalid input format: ${message}. Expected a valid Ethereum address (0x followed by 40 hexadecimal characters)`);
        }

        // Handle provider errors
        if (error instanceof Error && 'code' in error) {
            throw new Error(`Failed to ${context}: Provider error: ${error.message}`);
        }

        // Generic error with context
        const err = error as Error;
        const errorMessage = err.message || String(error);
        const detailsStr = details ? ` Details: ${Object.entries(details).map(([k, v]) => `${k}=${this.serializeValue(v)}`).join(', ')}` : '';
        throw new Error(`Failed to ${context}: ${errorMessage}${detailsStr}`);
    }

    private serializeValue(value: any): string {
        if (value === undefined) return 'undefined';
        if (value === null) return 'null';
        if (typeof value === 'bigint') return value.toString();
        if (Array.isArray(value)) {
            return `[${value.map(v => this.serializeValue(v)).join(', ')}]`;
        }
        if (typeof value === 'object') {
            if ('toJSON' in value && typeof value.toJSON === 'function') {
                return value.toJSON();
            }
            return JSON.stringify(value, (_, v) => 
                typeof v === 'bigint' ? v.toString() : v
            );
        }
        return String(value);
    }

    private getProvider(provider?: string): ethers.Provider {
        if (!provider) {
            return this.defaultProvider;
        }

        // Check if it's a default provider
        if (DEFAULT_PROVIDERS.includes(provider as DefaultProvider)) {
            try {
                return this.createInfuraProvider(provider as DefaultProvider);
            } catch (error) {
                this.handleProviderError(error, `create Infura provider for network ${provider}`);
            }
        }

        // Otherwise treat it as an RPC URL
        if (provider.startsWith("http")) {
            try {
                this.validateRpcUrl(provider);
                return new ethers.JsonRpcProvider(provider);
            } catch (error) {
                this.handleProviderError(error, `create provider with RPC URL ${provider}`);
            }
        }

        throw new Error(
            `Invalid provider: ${provider}. Must be either:\n` +
            `1. A supported network name (${DEFAULT_PROVIDERS.join(", ")})\n` +
            `2. A valid RPC URL starting with http:// or https://`
        );
    }

    async getBalance(address: string, provider?: string): Promise<string> {
        try {
            addressSchema.parse(address);
            const selectedProvider = this.getProvider(provider);
            const balance = await selectedProvider.getBalance(address);
            return ethers.formatEther(balance);
        } catch (error) {
            this.handleProviderError(error, "fetch balance", { address });
        }
    }

    async getERC20Balance(address: string, tokenAddress: string, provider?: string): Promise<string> {
        try {
            addressSchema.parse(address);
            addressSchema.parse(tokenAddress);
            const selectedProvider = this.getProvider(provider);
            const contract = new ethers.Contract(
                tokenAddress,
                [
                    "function balanceOf(address) view returns (uint)",
                    "function decimals() view returns (uint8)"
                ],
                selectedProvider
            );

            const decimals = await contract.decimals();
            const balance = await contract.balanceOf(address);
            return ethers.formatUnits(balance, decimals);
        } catch (error) {
            this.handleProviderError(error, "fetch ERC20 balance", { address, tokenAddress });
        }
    }

    async getTransactionCount(address: string, provider?: string): Promise<number> {
        try {
            addressSchema.parse(address);
            const selectedProvider = this.getProvider(provider);
            const count = await selectedProvider.getTransactionCount(address);
            return count;
        } catch (error) {
            this.handleProviderError(error, "fetch transaction count", { address });
        }
    }

    async getBlockNumber(provider?: string): Promise<number> {
        try {
            const selectedProvider = this.getProvider(provider);
            return await selectedProvider.getBlockNumber();
        } catch (error) {
            this.handleProviderError(error, "fetch latest block number");
        }
    }

    async getBlockDetails(blockTag: string | number, provider?: string): Promise<ethers.Block | null> {
        try {
            const selectedProvider = this.getProvider(provider);
            const block = await selectedProvider.getBlock(blockTag);
            return block;
        } catch (error) {
            this.handleProviderError(error, "fetch block details", { blockTag: String(blockTag) });
        }
    }

    async getTransactionDetails(txHash: string, provider?: string): Promise<ethers.TransactionResponse | null> {
        try {
            const txSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
            txSchema.parse(txHash);
            const selectedProvider = this.getProvider(provider);
            return await selectedProvider.getTransaction(txHash);
        } catch (error) {
            this.handleProviderError(error, "fetch transaction details", { txHash });
        }
    }

    async getGasPrice(provider?: string): Promise<string> {
        try {
            const selectedProvider = this.getProvider(provider);
            const feeData = await selectedProvider.getFeeData();
            return ethers.formatUnits(feeData.gasPrice || 0n, "gwei");
        } catch (error) {
            this.handleProviderError(error, "get gas price");
        }
    }

    async getFeeData(provider?: string): Promise<ethers.FeeData> {
        try {
            const selectedProvider = this.getProvider(provider);
            return await selectedProvider.getFeeData();
        } catch (error) {
            this.handleProviderError(error, "get fee data");
        }
    }

    async getContractCode(address: string, provider?: string): Promise<string | null> {
        try {
            addressSchema.parse(address);
            const selectedProvider = this.getProvider(provider);
            return await selectedProvider.getCode(address);
        } catch (error) {
            this.handleProviderError(error, "get contract bytecode", { address });
        }
    }

    async lookupAddress(address: string, provider?: string): Promise<string | null> {
        try {
            addressSchema.parse(address);
            const selectedProvider = this.getProvider(provider);
            return await selectedProvider.lookupAddress(address);
        } catch (error) {
            this.handleProviderError(error, "look up ENS name for address", { address });
        }
    }

    async resolveName(name: string, provider?: string): Promise<string | null> {
        try {
            const selectedProvider = this.getProvider(provider);
            return await selectedProvider.resolveName(name);
        } catch (error) {
            this.handleProviderError(error, "resolve ENS name", { name });
        }
    }

    formatEther(wei: string | number | bigint): string {
        try {
            return ethers.formatEther(wei);
        } catch (error) {
            this.handleProviderError(error, "format Ether value", { wei: String(wei) });
        }
    }

    parseEther(ether: string): bigint {
        try {
            return ethers.parseEther(ether);
        } catch (error) {
            this.handleProviderError(error, "parse Ether string", { ether });
        }
    }

    formatUnits(value: string | number | bigint, unit: string | number): string {
        try {
            return ethers.formatUnits(value, unit);
        } catch (error) {
            this.handleProviderError(error, "format units", { value: String(value), unit: String(unit) });
        }
    }

    parseUnits(value: string, unit: string | number): bigint {
        try {
            return ethers.parseUnits(value, unit);
        } catch (error) {
            this.handleProviderError(error, "parse units", { value, unit: String(unit) });
        }
    }

    private getSigner(provider?: string): ethers.Signer {
        if (this.defaultSigner) {
            return this.defaultSigner;
        }
        
        const privateKey = process.env.PRIVATE_KEY;
        if (!privateKey) {
            throw new Error("Missing PRIVATE_KEY in environment variables. Either provide a signer in the constructor or set PRIVATE_KEY in environment variables.");
        }
        const selectedProvider = this.getProvider(provider);
        return new ethers.Wallet(privateKey, selectedProvider);
    }

    async createTransaction(to: string, value: string, data?: string, provider?: string): Promise<ethers.TransactionRequest> {
        try {
            addressSchema.parse(to);
            const parsedValue = ethers.parseEther(value);

            const transaction: ethers.TransactionRequest = {
                to,
                value: parsedValue,
                data: data || "0x",
            };
            
            const signer = this.getSigner(provider);
            const populatedTx = await signer.populateTransaction(transaction);
            return populatedTx;
        } catch (error) {
            this.handleProviderError(error, "create transaction", { to, value });
        }
    }

    async estimateGas(tx: ethers.TransactionRequest, provider?: string): Promise<bigint> {
        try {
            const signer = this.getSigner(provider);
            const result = await signer.estimateGas(tx);
            return result;
        } catch (error) {
            this.handleProviderError(error, "estimate gas", { tx: JSON.stringify(tx) });
        }
    }

    async sendTransaction(
        toOrTx: string | ethers.TransactionRequest,
        value?: string,
        data?: string,
        provider?: string
    ): Promise<ethers.TransactionResponse> {
        try {
            let tx: ethers.TransactionRequest;
            
            if (typeof toOrTx === 'string') {
                // Handle old-style parameter based call
                addressSchema.parse(toOrTx);
                tx = {
                    to: toOrTx,
                    value: value ? ethers.parseEther(value) : undefined,
                    data: data || "0x"
                };
            } else {
                // Handle object-style call
                if (toOrTx.to) {
                    addressSchema.parse(toOrTx.to);
                }
                tx = toOrTx;
            }

            const signer = this.getSigner(provider);
            return await signer.sendTransaction(tx);
        } catch (error) {
            this.handleProviderError(error, "send transaction", { tx: toOrTx });
        }
    }

    async signMessage(message: string, provider?: string): Promise<string> {
        try {
            const signer = this.getSigner(provider);
            return await signer.signMessage(message);
        } catch (error) {
            this.handleProviderError(error, "sign message", { message });
        }
    }

    async contractCall(
        contractAddress: string,
        abi: string | Array<string>,
        method: string,
        args: any[] = [],
        value: string = "0",
        provider?: string
    ): Promise<any> {
        try {
            addressSchema.parse(contractAddress);
            const selectedProvider = this.getProvider(provider);
            
            // Create contract instance with provider
            const contract = new ethers.Contract(
                contractAddress,
                abi,
                selectedProvider
            );

            // Get function fragment to check if it's view/pure
            const fragment = contract.interface.getFunction(method);
            if (!fragment) {
                throw new Error(`Method ${method} not found in contract ABI`);
            }

            // For view/pure functions, use provider directly
            if (fragment.constant || fragment.stateMutability === 'view' || fragment.stateMutability === 'pure') {
                const result = await contract[method](...args);
                return this.serializeEventArgs(result); // Use our serializer for the result
            }

            // For state-changing functions, use signer
            const signer = this.getSigner(provider);
            const contractWithSigner = contract.connect(signer);
            const parsedValue = ethers.parseEther(value);
            const result = await contractWithSigner[method](...args, { value: parsedValue });
            return this.serializeEventArgs(result);
        } catch (error) {
            this.handleProviderError(error, `call contract method: ${method}`, {
                contractAddress,
                abi: typeof abi === 'string' ? abi : JSON.stringify(abi),
                args: this.serializeValue(args),
                value
            });
        }
    }

    async contractCallWithEstimate(
        contractAddress: string,
        abi: string,
        method: string,
        args: any[] = [],
        value: string = "0",
        provider?: string
    ): Promise<any> {
        try {
            addressSchema.parse(contractAddress);
            const signer = this.getSigner(provider);
            const contract = new ethers.Contract(
                contractAddress,
                abi,
                signer
            );
            const parsedValue = ethers.parseEther(value);
            
            // Get the function fragment for the method
            const fragment = contract.interface.getFunction(method);
            if (!fragment) {
                throw new Error(`Method ${method} not found in contract ABI`);
            }
            
            // Encode the function data
            const data = contract.interface.encodeFunctionData(fragment, args);
            
            // Create the transaction request
            const tx = {
                to: contractAddress,
                data,
                value: parsedValue
            };
            
            // Estimate the gas
            const estimatedGas = await signer.estimateGas(tx);
            
            // Add the estimated gas and send the transaction
            return await this.contractSendTransaction(
                contractAddress,
                abi,
                method,
                args,
                value,
                provider,
                { gasLimit: estimatedGas }
            );
        } catch (error) {
            this.handleProviderError(error, `call contract method with estimate: ${method}`, {
                contractAddress,
                abi: JSON.stringify(abi),
                args: JSON.stringify(args),
                value
            });
        }
    }

    async contractCallWithOverrides(
        contractAddress: string,
        abi: string,
        method: string,
        args: any[] = [],
        value: string = "0",
        provider?: string,
        overrides?: ethers.Overrides
    ): Promise<any> {
        try {
            addressSchema.parse(contractAddress);
            const signer = this.getSigner(provider);
            const contract = new ethers.Contract(
                contractAddress,
                abi,
                signer
            );
            const parsedValue = ethers.parseEther(value);
            
            // Get the function fragment for the method
            const fragment = contract.interface.getFunction(method);
            if (!fragment) {
                throw new Error(`Method ${method} not found in contract ABI`);
            }
            
            // Merge value with other overrides
            const txOverrides = {
                ...overrides,
                value: parsedValue
            };
            
            // Call the contract method with overrides
            const tx = await contract[method](...args, txOverrides);
            return tx;
        } catch (error) {
            this.handleProviderError(error, `call contract method with overrides: ${method}`, {
                contractAddress,
                abi: JSON.stringify(abi),
                args: this.serializeValue(args),
                value,
                overrides: this.serializeValue(overrides)
            });
        }
    }

    async contractSendTransaction(
        contractAddress: string,
        abi: string,
        method: string,
        args: any[] = [],
        value: string = "0",
        provider?: string,
        overrides?: ethers.Overrides
    ): Promise<ethers.TransactionResponse> {
        try {
            addressSchema.parse(contractAddress);
            const signer = this.getSigner(provider);
            const contract = new ethers.Contract(
                contractAddress,
                abi,
                signer
            );
            const parsedValue = ethers.parseEther(value);
            
            // Get the function fragment for the method
            const fragment = contract.interface.getFunction(method);
            if (!fragment) {
                throw new Error(`Method ${method} not found in contract ABI`);
            }
            
            // Encode the function data
            const data = contract.interface.encodeFunctionData(fragment, args);
            
            // Create the transaction request with overrides
            const tx = {
                to: contractAddress,
                data,
                value: parsedValue,
                ...overrides
            };
            
            // Send the transaction
            return await signer.sendTransaction(tx);
        } catch (error) {
            this.handleProviderError(error, `send transaction to contract method: ${method}`, {
                contractAddress,
                abi: JSON.stringify(abi),
                args: JSON.stringify(args),
                value
            });
        }
    }

    async contractSendTransactionWithEstimate(
        contractAddress: string,
        abi: string,
        method: string,
        args: any[],
        value: string = "0",
        provider?: string
    ): Promise<ethers.TransactionResponse> {
        try {
            const parsedAddress = addressSchema.parse(contractAddress);
            const contract = new ethers.Contract(parsedAddress, abi, await this.getSigner(provider));
            const parsedValue = ethers.parseEther(value);

            // Get the function fragment for the method
            const fragment = contract.interface.getFunction(method);
            if (!fragment) {
                throw new Error(`Method ${method} not found in contract ABI`);
            }
            
            // Encode the function data with value
            const data = contract.interface.encodeFunctionData(fragment, args);
            const tx = {
                to: parsedAddress,
                data,
                value: parsedValue
            };

            // Estimate gas
            const gasEstimate = await contract.getFunction(method).estimateGas(...args, { value: parsedValue });
            
            // Send transaction with estimated gas
            return await contract.getFunction(method)(...args, {
                value: parsedValue,
                gasLimit: gasEstimate
            });
        } catch (error) {
            throw this.handleProviderError(error, `send transaction to contract method with estimate: ${method}`, {
                contractAddress,
                abi: JSON.stringify(abi),
                args: JSON.stringify(args),
                value
            });
        }
    }

    async contractSendTransactionWithOverrides(
        contractAddress: string,
        abi: string,
        method: string,
        args: any[],
        value: string = "0",
        provider?: string,
        overrides: ethers.Overrides = {}
    ): Promise<ethers.TransactionResponse> {
        try {
            const parsedAddress = addressSchema.parse(contractAddress);
            const contract = new ethers.Contract(parsedAddress, abi, await this.getSigner(provider));
            const parsedValue = ethers.parseEther(value);

            // Get the function fragment for the method
            const fragment = contract.interface.getFunction(method);
            if (!fragment) {
                throw new Error(`Method ${method} not found in contract ABI`);
            }
            
            // Merge value with other overrides
            const txOverrides = {
                ...overrides,
                value: parsedValue
            };

            // Encode the function data
            const data = contract.interface.encodeFunctionData(fragment, args);
            
            // Send transaction with overrides
            return await contract.getFunction(method)(...args, txOverrides);
        } catch (error) {
            throw this.handleProviderError(error, `send transaction to contract method with overrides: ${method}`, {
                contractAddress,
                abi: JSON.stringify(abi),
                args: this.serializeValue(args),
                value,
                overrides: this.serializeValue(overrides)
            });
        }
    }

    async sendRawTransaction(
        signedTransaction: string,
        provider?: string
    ): Promise<ethers.TransactionResponse> {
        try {
            const selectedProvider = this.getProvider(provider);
            return await selectedProvider.broadcastTransaction(signedTransaction);
        } catch (error) {
            this.handleProviderError(error, "send raw transaction", { signedTransaction });
        }
    }

    private formatEvent(log: ethers.EventLog | ethers.Log): any {
        const formattedEvent = {
            address: log.address,
            blockNumber: log.blockNumber?.toString(),
            transactionHash: log.transactionHash,
            logIndex: log.index,
            name: 'eventName' in log ? log.eventName : undefined,
            args: 'args' in log ? this.serializeEventArgs(log.args) : undefined,
            data: log.data,
            topics: log.topics
        };
        return formattedEvent;
    }

    private serializeEventArgs(args: any): any {
        if (args === null || args === undefined) return args;
        if (typeof args === 'bigint') return args.toString();
        if (Array.isArray(args)) {
            return args.map(arg => this.serializeEventArgs(arg));
        }
        if (typeof args === 'object') {
            const serialized: any = {};
            for (const [key, value] of Object.entries(args)) {
                if (key === 'length' && Array.isArray(args)) continue;
                if (key === '_isBigNumber' || key === 'type' || key === 'hash') continue; // Skip internal ethers properties
                serialized[key] = this.serializeEventArgs(value);
            }
            return serialized;
        }
        return args;
    }

    async queryLogs(
        address?: string,
        topics?: Array<string | null | Array<string>>,
        fromBlock?: string | number,
        toBlock?: string | number,
        provider?: string
    ): Promise<any> {
        try {
            let checksummedAddress: string | undefined;
            if (address) {
                checksummedAddress = ethers.getAddress(address);
            }
            const selectedProvider = this.getProvider(provider);
            const filter: ethers.Filter = {
                address: checksummedAddress,
                topics: topics
            };

            const logs = await selectedProvider.getLogs({
                ...filter,
                fromBlock: fromBlock,
                toBlock: toBlock
            });

            return logs.map((log) => this.formatEvent(log));
        } catch (error) {
            this.handleProviderError(error, "query logs", {
                address: address || "any",
                topics: topics ? JSON.stringify(topics) : "any",
                fromBlock: String(fromBlock || "any"),
                toBlock: String(toBlock || "any")
            });
        }
    }

    async contractEvents(
        contractAddress: string,
        abi: string | Array<string>,
        eventName?: string,
        topics?: Array<string | null | Array<string>>,
        fromBlock?: string | number,
        toBlock?: string | number,
        provider?: string
    ): Promise<any> {
        try {
            // Use queryLogs under the hood as it's more reliable
            const checksummedAddress = ethers.getAddress(contractAddress);
            const selectedProvider = this.getProvider(provider);
            const contract = new ethers.Contract(checksummedAddress, abi, selectedProvider);

            // If no event name specified, get all events
            if (!eventName) {
                return this.queryLogs(
                    checksummedAddress,
                    topics,
                    fromBlock,
                    toBlock,
                    provider
                );
            }

            // Get the event fragment to encode topics
            const fragment = contract.interface.getEvent(eventName);
            if (!fragment) {
                throw new Error(`Event ${eventName} not found in contract ABI`);
            }

            // Get the topic hash for this event
            const topicHash = contract.interface.getEventTopic(fragment);
            const eventTopics = [topicHash];
            if (topics && topics.length > 0) {
                eventTopics.push(...topics);
            }

            // Use queryLogs with the event-specific topic
            const logs = await this.queryLogs(
                checksummedAddress,
                eventTopics,
                fromBlock,
                toBlock,
                provider
            );

            // Parse the logs with the contract interface
            return logs.map(log => {
                try {
                    const parsedLog = contract.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });
                    return {
                        ...log,
                        name: parsedLog?.name,
                        args: this.serializeEventArgs(parsedLog?.args)
                    };
                } catch (e) {
                    // If parsing fails, return the raw log
                    return log;
                }
            });
        } catch (error) {
            this.handleProviderError(error, "query contract events", {
                contractAddress,
                abi: typeof abi === 'string' ? abi : JSON.stringify(abi),
                eventName: eventName || "any",
                topics: topics ? this.serializeValue(topics) : "any",
                fromBlock: String(fromBlock || "any"),
                toBlock: String(toBlock || "any")
            });
        }
    }
} 