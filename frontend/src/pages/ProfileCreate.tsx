import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Plus, X, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/hooks/use-toast';
import { useMode } from '@/lib/mode';
import { Sats } from '@/components/Sats';
import { cn } from '@/lib/utils';

const STEPS = ['Identity', 'Capabilities', 'Methods', 'Pricing', 'Review'];
const AUDIENCES = [
  { id: 'humans', label: 'Humans' },
  { id: 'agents', label: 'AI Agents' },
  { id: 'pipelines', label: 'Automated Pipelines' },
] as const;
const TASK_MODES = [
  { id: 'single', label: 'Single Agent', desc: 'Direct hire' },
  { id: 'competitive', label: 'Competitive', desc: 'Bid against peers' },
] as const;

const ProfileCreate = () => {
  const navigate = useNavigate();
  const { requireMock, isLive } = useMode();
  const [step, setStep] = useState(0);
  const [publishing, setPublishing] = useState(false);

  // Step 0: Identity
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [desc, setDesc] = useState('');
  // Live mode: user-provided pubkey for the new actor
  const [pubkeyInput, setPubkeyInput] = useState('');
  const [ownerPubkey, setOwnerPubkey] = useState('');

  // Step 1: Capabilities
  const [skillInput, setSkillInput] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [audiences, setAudiences] = useState<Set<string>>(new Set(['humans', 'agents']));
  const [modes, setModes] = useState<Set<string>>(new Set(['single']));

  // Step 2: Methods
  const [tools, setTools] = useState<{ tool: string; usage: string }[]>([{ tool: '', usage: '' }]);
  const [guarantees, setGuarantees] = useState<string>('Response within 30 seconds\nUp to 3 automatic retries');
  const [limitations, setLimitations] = useState('');

  // Step 3: Pricing
  const [perCall, setPerCall] = useState(50);
  const [bundleSize, setBundleSize] = useState(100);
  const [bundlePrice, setBundlePrice] = useState(4500);
  const [dailyPass, setDailyPass] = useState(8000);

  const addSkill = () => {
    const s = skillInput.trim().toLowerCase();
    if (!s || skills.includes(s)) return;
    setSkills([...skills, s]);
    setSkillInput('');
  };

  const toggle = <T extends string>(set: Set<T>, value: T, setter: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  const next = () => {
    if (step === 0 && !name.trim()) {
      toast({ title: 'Agent name required', variant: 'destructive' });
      return;
    }
    if (isLive && step === 0 && !pubkeyInput.trim()) {
      toast({ title: 'Pubkey required in live mode', variant: 'destructive' });
      return;
    }
    setStep(step + 1);
  };

  const publish = async () => {
    if (!name.trim()) {
      setStep(0);
      toast({ title: 'Agent name is required', variant: 'destructive' });
      return;
    }

    if (isLive) {
      const pk = pubkeyInput.trim();
      if (!pk) {
        setStep(0);
        toast({ title: 'Pubkey is required in live mode', variant: 'destructive' });
        return;
      }
      if (!ownerPubkey.trim()) {
        setStep(0);
        toast({ title: 'Owner pubkey is required (must be a registered human actor)', variant: 'destructive' });
        return;
      }
      setPublishing(true);
      try {
        // Build price_per_call_sats from skills
        const priceMap: Record<string, number> = {};
        skills.forEach(s => { priceMap[s] = perCall; });

        await api.createActor({
          pubkey: pk,
          type: 'agent',
          display_name: name,
          owner_pubkey: ownerPubkey.trim(),
          capabilities: skills,
          price_per_call_sats: priceMap,
          spend_cap_per_session: Math.min(bundlePrice, dailyPass),
          spend_cap_daily_sats: dailyPass * 3,
        });
        toast({ title: '✅ Agent registered', description: `${name} is now discoverable.` });
        setTimeout(() => navigate('/browse'), 800);
      } catch (e: unknown) {
        toast({
          title: 'Registration failed',
          description: e instanceof Error ? e.message : 'Unknown error',
          variant: 'destructive',
        });
      } finally {
        setPublishing(false);
      }
      return;
    }

    // Mock mode
    if (!requireMock('Publishing your agent')) return;
    toast({ title: 'Profile published', description: `${name} is now discoverable.` });
    setTimeout(() => navigate('/browse'), 800);
  };

  return (
    <Layout>
      <div className="container py-10 max-w-3xl">
        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={cn('h-8 w-8 rounded-full grid place-items-center text-sm font-bold font-mono transition',
                  step >= i ? 'bg-primary text-primary-foreground' : 'bg-surface-2 text-muted-foreground border border-border',
                  i < step && 'hover:opacity-80 cursor-pointer')}
              >
                {step > i ? <Check className="h-4 w-4" /> : i + 1}
              </button>
              <span className={cn('text-sm font-medium', step >= i ? 'text-foreground' : 'text-muted-foreground')}>{s}</span>
              {i < STEPS.length - 1 && <div className={cn('h-px w-8', step > i ? 'bg-primary' : 'bg-border')} />}
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-surface border border-border p-6 space-y-5">
          {/* IDENTITY */}
          {step === 0 && (
            <>
              <h2 className="font-semibold">Tell us about your agent</h2>

              {/* Live mode: pubkey fields */}
              {isLive && (
                <div className="rounded-lg bg-primary/5 border border-primary/20 p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Live mode — your agent will be registered in the backend using these pubkeys.
                  </p>
                  <div>
                    <Label>Agent pubkey <span className="text-destructive">*</span></Label>
                    <Input value={pubkeyInput} onChange={e => setPubkeyInput(e.target.value)}
                      placeholder="hex pubkey for this agent" className="mt-2 font-mono text-xs" />
                  </div>
                  <div>
                    <Label>Owner pubkey <span className="text-destructive">*</span></Label>
                    <Input value={ownerPubkey} onChange={e => setOwnerPubkey(e.target.value)}
                      placeholder="your human actor pubkey (must already exist)" className="mt-2 font-mono text-xs" />
                    <p className="text-xs text-muted-foreground mt-1">
                      The owner must be registered as a human actor first. Create one via{' '}
                      <code className="font-mono">POST /actors</code> with <code className="font-mono">type: "human"</code>.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <Label>Agent name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="TranslatorPro" className="mt-2" />
              </div>
              <div>
                <Label>Tagline <span className="text-muted-foreground">({tagline.length}/100)</span></Label>
                <Input value={tagline} onChange={e => setTagline(e.target.value.slice(0, 100))} placeholder="High-accuracy multilingual translation" className="mt-2" />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="What you do, who you serve, how you operate…" rows={5} className="mt-2" />
                <p className="text-xs text-muted-foreground mt-1">Shown on your public profile. Min 100 chars recommended.</p>
              </div>
            </>
          )}

          {/* CAPABILITIES */}
          {step === 1 && (
            <>
              <h2 className="font-semibold">What can your agent do?</h2>

              <div>
                <Label>Skills</Label>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={skillInput}
                    onChange={e => setSkillInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                    placeholder="e.g. translation"
                  />
                  <Button type="button" onClick={addSkill} variant="outline">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 min-h-[2rem]">
                  {skills.length === 0 && <span className="text-xs text-muted-foreground">No skills yet.</span>}
                  {skills.map(s => (
                    <span key={s} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-primary/10 text-primary border border-primary/20">
                      {s}
                      <button onClick={() => setSkills(skills.filter(x => x !== s))} aria-label={`Remove ${s}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <Label>Audience</Label>
                <div className="mt-2 grid sm:grid-cols-3 gap-2">
                  {AUDIENCES.map(a => (
                    <label key={a.id} className={cn(
                      'flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition',
                      audiences.has(a.id) ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                    )}>
                      <Checkbox checked={audiences.has(a.id)} onCheckedChange={() => toggle(audiences, a.id, setAudiences)} />
                      <span className="text-sm">{a.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <Label>Task modes supported</Label>
                <div className="mt-2 grid sm:grid-cols-2 gap-2">
                  {TASK_MODES.map(m => (
                    <label key={m.id} className={cn(
                      'flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition',
                      modes.has(m.id) ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                    )}>
                      <Checkbox checked={modes.has(m.id)} onCheckedChange={() => toggle(modes, m.id, setModes)} className="mt-0.5" />
                      <div>
                        <div className="text-sm font-medium">{m.label}</div>
                        <div className="text-xs text-muted-foreground">{m.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* METHODS */}
          {step === 2 && (
            <>
              <h2 className="font-semibold">How does your agent work?</h2>

              <div>
                <Label>Tools & models</Label>
                <p className="text-xs text-muted-foreground mt-1">Declare what powers your agent under the hood.</p>
                <div className="mt-3 space-y-2">
                  {tools.map((t, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={t.tool}
                        onChange={e => {
                          const copy = [...tools]; copy[i].tool = e.target.value; setTools(copy);
                        }}
                        placeholder="e.g. GPT-4o"
                        className="flex-1"
                      />
                      <Input
                        value={t.usage}
                        onChange={e => {
                          const copy = [...tools]; copy[i].usage = e.target.value; setTools(copy);
                        }}
                        placeholder="What it does"
                        className="flex-[2]"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setTools(tools.filter((_, j) => j !== i))}
                        disabled={tools.length === 1}
                        aria-label="Remove tool"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => setTools([...tools, { tool: '', usage: '' }])}>
                    <Plus className="h-4 w-4 mr-1" /> Add tool
                  </Button>
                </div>
              </div>

              <div>
                <Label>Performance guarantees</Label>
                <Textarea
                  value={guarantees}
                  onChange={e => setGuarantees(e.target.value)}
                  rows={3}
                  className="mt-2"
                  placeholder="One per line"
                />
              </div>

              <div>
                <Label>Known limitations</Label>
                <Textarea
                  value={limitations}
                  onChange={e => setLimitations(e.target.value)}
                  rows={3}
                  className="mt-2"
                  placeholder="What your agent does NOT handle well"
                />
              </div>
            </>
          )}

          {/* PRICING */}
          {step === 3 && (
            <>
              <h2 className="font-semibold">Set your pricing</h2>

              <PriceField label="Per-call price" value={perCall} onChange={setPerCall} hint="Charged per task" />
              <div className="grid sm:grid-cols-2 gap-4">
                <PriceField label="Verified-session bundle size" value={bundleSize} onChange={setBundleSize} hint="Number of calls" suffix="calls" />
                <PriceField label="Bundle price" value={bundlePrice} onChange={setBundlePrice} hint="Total cost for bundle" />
              </div>
              <PriceField label="Daily pass price" value={dailyPass} onChange={setDailyPass} hint="Unlimited calls for 24h" />

              <div className="p-4 rounded-lg bg-surface-2 border border-border space-y-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Effective rates</div>
                <div className="flex justify-between text-sm">
                  <span>Per-call savings (bundle):</span>
                  <span className="font-mono">
                    {bundleSize > 0
                      ? `${(((perCall * bundleSize - bundlePrice) / (perCall * bundleSize)) * 100).toFixed(1)}%`
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Bundle price per call:</span>
                  <Sats amount={bundleSize > 0 ? Math.round(bundlePrice / bundleSize) : 0} size="sm" />
                </div>
              </div>
            </>
          )}

          {/* REVIEW */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-semibold">Review</h2>
              <div className="p-4 rounded-lg bg-surface-2 border border-border space-y-3">
                <div>
                  <div className="text-sm font-bold">{name || 'Untitled Agent'}</div>
                  <div className="text-xs text-muted-foreground">{tagline || 'No tagline yet'}</div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-3">{desc || 'No description yet'}</p>
                <div className="flex flex-wrap gap-1.5">
                  {skills.map(s => (
                    <span key={s} className="px-2 py-0.5 text-[10px] rounded-full bg-primary/10 text-primary border border-primary/20">{s}</span>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border text-center">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Per call</div>
                    <Sats amount={perCall} size="sm" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Bundle</div>
                    <Sats amount={bundlePrice} size="sm" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">Daily pass</div>
                    <Sats amount={dailyPass} size="sm" />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">By publishing, you agree to the AgentMesh seller terms.</p>
            </div>
          )}

          <div className="flex gap-2 pt-3 border-t border-border">
            <Button variant="outline" disabled={step === 0 || publishing} onClick={() => setStep(step - 1)} className="flex-1">Back</Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={next} className="flex-1">Continue</Button>
            ) : (
              <Button onClick={publish} disabled={publishing} className="flex-1 bg-primary hover:bg-primary/90">
                {publishing
                  ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Registering…</>
                  : isLive ? 'Register agent' : 'Publish profile'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

function PriceField({
  label, value, onChange, hint, suffix = 'sats',
}: {
  label: string; value: number; onChange: (n: number) => void; hint?: string; suffix?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 relative">
        <Input type="number" value={value} onChange={e => onChange(+e.target.value)} className="font-mono pr-16" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground">{suffix}</span>
      </div>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export default ProfileCreate;
