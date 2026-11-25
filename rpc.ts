import type {
  PluginRpcCallArgs,
  PluginRpcClient,
  PluginRpcContract,
  PluginRpcResult,
} from "@get-bb/plugin-sdk/app";

/**
 * The request `useRpc` sends, for callbacks outside React: a message action's
 * `run` has no hook context to read the client from.
 */
export function createRpcClient<Contract extends PluginRpcContract>(
  pluginId: string,
): PluginRpcClient<Contract> {
  return {
    async call<Method extends Extract<keyof Contract, string>>(
      method: Method,
      ...args: PluginRpcCallArgs<Contract[Method]>
    ): Promise<PluginRpcResult<Contract[Method]>> {
      const response = await fetch(
        `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/${encodeURIComponent(method)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(args[0] ?? null),
        },
      );
      const envelope = (await response.json().catch(() => null)) as {
        ok?: unknown;
        result?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok || envelope?.ok !== true) {
        const error = envelope?.error;
        const message =
          typeof error === "string"
            ? error
            : typeof (error as { message?: unknown } | null)?.message === "string"
              ? (error as { message: string }).message
              : `rpc "${method}" failed (HTTP ${response.status})`;
        throw new Error(message);
      }
      return envelope.result as PluginRpcResult<Contract[Method]>;
    },
  };
}
