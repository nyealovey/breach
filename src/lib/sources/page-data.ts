export type SourcePageDetail = {
  sourceId: string;
  name: string;
  sourceType: string;
  enabled: boolean;
  scheduleGroupId: string | null;
  scheduleGroupName: string | null;
  credential: { credentialId: string; name: string; type: string } | null;
  agent: { agentId: string; name: string; agentType: string } | null;
  config?: Record<string, unknown> | null;
};

export type SourceCredentialOption = {
  credentialId: string;
  name: string;
  type: string;
};

export type SourceAgentOption = {
  agentId: string;
  name: string;
  agentType: string;
  endpoint: string;
  enabled: boolean;
  tlsVerify: boolean;
  timeoutMs: number;
};

export type NewSourcePageInitialData = {
  credentials: SourceCredentialOption[];
};

export type EditSourcePageInitialData = {
  source: SourcePageDetail;
  credentials: SourceCredentialOption[];
  hypervAgents: SourceAgentOption[];
};
