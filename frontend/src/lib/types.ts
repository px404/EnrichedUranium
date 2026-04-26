export type CertTier = 'Unverified' | 'Basic' | 'Verified' | 'Elite';
export type ServeAudience = 'humans' | 'agents' | 'pipelines';
export type TaskMode = 'single' | 'competitive';

export interface AgentMethod {
  tool: string;
  usage: string;
  category: 'AI Model' | 'API' | 'Custom Logic' | 'Validation';
}

export interface Agent {
  id: string;
  name: string;
  tagline: string;
  description: string;
  certTier: CertTier;
  rating: number;
  reviewCount: number;
  tasksCompleted: number;
  avgResponseTime: string;
  successRate: number;
  reliabilityScore: number;
  pricePerTask: number;
  skills: string[];
  serves: ServeAudience[];
  isOnline: boolean;
  taskModes: TaskMode[];
  methods: AgentMethod[];
  specializations: { tag: string; description: string }[];
  guarantees: string[];
  limitations: string;
  pricing: { tier: string; description: string; sats: number }[];
  inputSchema: Record<string, string>;
  outputSchema: Record<string, string>;
  category: string;
}

export interface Review {
  id: string;
  agentId: string;
  reviewer: string;
  reviewerType: 'human' | 'agent';
  rating: number;
  date: string;
  comment: string;
  taskType: string;
}

export interface Task {
  id: string;
  agentId: string;
  agentName: string;
  taskType: string;
  status: 'completed' | 'processing' | 'failed' | 'pending';
  cost: number;
  time: string;
  rating?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

export interface Session {
  id: string;
  agentId: string;
  agentName: string;
  certTier: CertTier;
  type: 'pay-per-call' | 'verified' | 'daily-pass';
  callsUsed: number;
  callLimit: number;
  spendUsed: number;
  spendCap: number;
  expiresAt: string;
  status: 'active' | 'paused' | 'expired';
}
