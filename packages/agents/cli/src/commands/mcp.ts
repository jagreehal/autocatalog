import { startMcpServer } from 'autocatalog-agents-mcp';

export const runMcp = async (args: string[]): Promise<number> => {
  await startMcpServer(args);

  return 0;
};
