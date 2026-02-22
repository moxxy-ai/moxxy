import { useState } from 'react';
import { Radio } from 'lucide-react';
import type { Channel } from '../types';

interface ChannelsPanelProps {
  apiBase: string;
  agents: string[];
  activeAgent: string | null;
  setActiveAgent: (agent: string) => void;
  channels: Channel[];
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>;
  sttEnabled: boolean;
  setSttEnabled: React.Dispatch<React.SetStateAction<boolean>>;
}

export function ChannelsPanel({
  apiBase,
  agents,
  activeAgent,
  setActiveAgent,
  channels,
  setChannels,
  sttEnabled,
  setSttEnabled,
}: ChannelsPanelProps) {
  const [tgTokenInput, setTgTokenInput] = useState('');
  const [tgPairCode, setTgPairCode] = useState('');
  const [channelStatus, setChannelStatus] = useState<string | null>(null);
  const [sttTokenInput, setSttTokenInput] = useState('');
  const [sttStatus, setSttStatus] = useState<string | null>(null);
  const [discordTokenInput, setDiscordTokenInput] = useState('');
  const [discordStatus, setDiscordStatus] = useState<string | null>(null);
  const [waAccountSid, setWaAccountSid] = useState('');
  const [waAuthToken, setWaAuthToken] = useState('');
  const [waFromNumber, setWaFromNumber] = useState('');
  const [waStatus, setWaStatus] = useState<string | null>(null);

  const tg = channels.find(c => c.type === 'telegram');
  const discord = channels.find(c => c.type === 'discord');
  const whatsapp = channels.find(c => c.type === 'whatsapp');

  const refreshChannels = () => {
    if (activeAgent && apiBase) {
      fetch(`${apiBase}/agents/${activeAgent}/channels`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setChannels(data.channels || []);
            const tgData = (data.channels || []).find((c: Channel) => c.type === 'telegram');
            if (tgData) setSttEnabled(!!tgData.stt_enabled);
          }
        });
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full p-4">
      <div className="bg-[#111927]/90 border border-[#1e304f] p-6 shadow-2xl backdrop-blur-sm h-full flex flex-col">
        <div className="flex justify-between items-center mb-4 border-b border-[#1e304f] pb-2">
          <h2 className="text-[#00aaff] uppercase tracking-widest text-sm">Channels - {activeAgent || 'No Agent'}</h2>
          <select
            className="bg-[#090d14] border border-[#1e304f] text-white px-3 py-1.5 outline-none rounded-sm text-xs focus:border-[#00aaff]"
            value={activeAgent || ''}
            onChange={e => setActiveAgent(e.target.value)}
          >
            <option disabled value="">Select Node</option>
            {agents.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* Telegram Card */}
          <div className="border border-[#1e304f] bg-[#0d1522] p-5 rounded-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio size={16} className="text-[#00aaff]" />
                <span className="text-white text-sm font-bold tracking-wide">Telegram</span>
              </div>
              {tg?.is_paired ? (
                <span className="text-[9px] px-2 py-0.5 border border-emerald-400/30 text-emerald-400 bg-emerald-400/5 rounded-sm uppercase tracking-widest">Paired</span>
              ) : tg?.has_token ? (
                <span className="text-[9px] px-2 py-0.5 border border-amber-400/30 text-amber-400 bg-amber-400/5 rounded-sm uppercase tracking-widest">Awaiting Pair</span>
              ) : (
                <span className="text-[9px] px-2 py-0.5 border border-[#64748b]/30 text-[#64748b] bg-[#64748b]/5 rounded-sm uppercase tracking-widest">Not Configured</span>
              )}
            </div>

            {channelStatus && (
              <div className={`text-[10px] px-2 py-1 border rounded-sm ${channelStatus.includes('Error') || channelStatus.includes('not match') ? 'border-red-400/30 text-red-400 bg-red-400/5' : 'border-emerald-400/30 text-emerald-400 bg-emerald-400/5'}`}>
                {channelStatus}
              </div>
            )}

            {/* State: No token */}
            {!tg?.has_token && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-[#94a3b8] leading-relaxed">Connect a Telegram bot to this agent. Get a token from <span className="text-[#00aaff]">@BotFather</span> on Telegram. One Telegram bot/channel can only be bound to one agent.</p>
                <input
                  type="password"
                  value={tgTokenInput}
                  onChange={e => setTgTokenInput(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="Bot token from @BotFather"
                />
                <button
                  onClick={async () => {
                    if (!tgTokenInput.trim() || !activeAgent) return;
                    setChannelStatus(null);
                    try {
                      const res = await fetch(`${apiBase}/agents/${activeAgent}/channels/telegram/token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: tgTokenInput })
                      });
                      const data = await res.json();
                      if (data.success) {
                        setChannelStatus('Token saved. Restart the gateway, then send /start to your bot.');
                        setTgTokenInput('');
                        refreshChannels();
                      } else {
                        setChannelStatus(`Error: ${data.error}`);
                      }
                    } catch (err) { setChannelStatus(`Error: ${err}`); }
                  }}
                  disabled={!tgTokenInput.trim()}
                  className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all self-start"
                >
                  Save Token
                </button>
              </div>
            )}

            {/* State: Token set, not paired */}
            {tg?.has_token && !tg?.is_paired && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-[#94a3b8] leading-relaxed">
                  Bot token is configured. To pair:
                </p>
                <div className="text-[10px] text-[#cbd5e1] bg-[#090d14] border border-[#1e304f] p-2 rounded-sm leading-relaxed">
                  1. Ensure the gateway is running<br/>
                  2. Open Telegram and send <span className="text-[#00aaff] font-mono">/start</span> to your bot<br/>
                  3. Enter the 6-digit code below
                </div>
                <input
                  type="text"
                  value={tgPairCode}
                  onChange={e => setTgPairCode(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono tracking-[0.3em] text-center"
                  placeholder="000000"
                  maxLength={6}
                />
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!tgPairCode.trim() || !activeAgent) return;
                      setChannelStatus(null);
                      try {
                        const res = await fetch(`${apiBase}/agents/${activeAgent}/channels/telegram/pair`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ code: tgPairCode })
                        });
                        const data = await res.json();
                        if (data.success) {
                          setChannelStatus('Telegram paired successfully!');
                          setTgPairCode('');
                          refreshChannels();
                        } else {
                          setChannelStatus(`Error: ${data.error}`);
                        }
                      } catch (err) { setChannelStatus(`Error: ${err}`); }
                    }}
                    disabled={tgPairCode.trim().length < 6}
                    className="bg-[#00aaff] hover:bg-[#33bfff] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all"
                  >
                    Verify &amp; Pair
                  </button>
                  {(tg as any)?.pairing_active && (
                    <button
                      onClick={async () => {
                        if (!activeAgent) return;
                        setChannelStatus(null);
                        try {
                          const res = await fetch(`${apiBase}/agents/${activeAgent}/channels/telegram/revoke`, {
                            method: 'POST'
                          });
                          const data = await res.json();
                          if (data.success) {
                            setChannelStatus('Pairing request revoked.');
                            setTgPairCode('');
                            refreshChannels();
                          } else {
                            setChannelStatus(`Error: ${data.error}`);
                          }
                        } catch (err) { setChannelStatus(`Error: ${err}`); }
                      }}
                      className="bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 text-red-400 text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold transition-all"
                    >
                      Revoke Request
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* State: Paired */}
            {tg?.is_paired && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-emerald-400 leading-relaxed">Telegram is connected and active. Messages are routed to this agent and mirrored into the shared terminal session.</p>
                <button
                  onClick={async () => {
                    if (!activeAgent) return;
                    setChannelStatus(null);
                    try {
                      const res = await fetch(`${apiBase}/agents/${activeAgent}/channels/telegram`, { method: 'DELETE' });
                      const data = await res.json();
                      if (data.success) {
                        setChannelStatus('Telegram disconnected. Restart gateway to fully remove.');
                        refreshChannels();
                      } else {
                        setChannelStatus(`Error: ${data.error}`);
                      }
                    } catch (err) { setChannelStatus(`Error: ${err}`); }
                  }}
                  className="bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 text-red-400 text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold transition-all self-start"
                >
                  Disconnect
                </button>
              </div>
            )}

            {/* Voice Recognition Settings */}
            {tg?.has_token && (
              <div className="border-t border-[#1e304f] pt-3 mt-1 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#94a3b8] uppercase tracking-widest">Voice Recognition (Whisper)</span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sttEnabled}
                      onChange={e => setSttEnabled(e.target.checked)}
                      className="accent-[#00aaff] w-3 h-3"
                    />
                    <span className="text-[10px] text-white">{sttEnabled ? 'Enabled' : 'Disabled'}</span>
                  </label>
                </div>
                {sttEnabled && (
                  <>
                    <input
                      type="password"
                      value={sttTokenInput}
                      onChange={e => setSttTokenInput(e.target.value)}
                      className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#00aaff] outline-none px-3 py-1.5 text-xs text-white font-mono"
                      placeholder={tg.has_stt_token ? '••••••••  (key saved)' : 'OpenAI API Key for Whisper'}
                    />
                    <p className="text-[10px] text-[#64748b]">Leave blank to use agent's existing OpenAI key. Provide a key here to override.</p>
                  </>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      if (!activeAgent) return;
                      setSttStatus(null);
                      try {
                        const res = await fetch(`${apiBase}/agents/${activeAgent}/channels/telegram/stt`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ enabled: sttEnabled, token: sttTokenInput || null })
                        });
                        const data = await res.json();
                        if (data.success) {
                          setSttStatus('Voice settings saved.');
                          setSttTokenInput('');
                          refreshChannels();
                        } else {
                          setSttStatus(`Error: ${data.error}`);
                        }
                      } catch (err) { setSttStatus(`Error: ${err}`); }
                    }}
                    className="bg-[#00aaff] hover:bg-[#33bfff] text-white text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold shadow-[0_0_12px_rgba(0,170,255,0.3)] transition-all"
                  >
                    Save Voice Settings
                  </button>
                  {sttStatus && (
                    <span className={`text-[10px] ${sttStatus.includes('Error') ? 'text-red-400' : 'text-emerald-400'}`}>{sttStatus}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Discord Card */}
          <div className="border border-[#1e304f] bg-[#0d1522] p-5 rounded-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio size={16} className="text-[#7c3aed]" />
                <span className="text-white text-sm font-bold tracking-wide">Discord</span>
              </div>
              {discord?.has_token ? (
                <span className="text-[9px] px-2 py-0.5 border border-emerald-400/30 text-emerald-400 bg-emerald-400/5 rounded-sm uppercase tracking-widest">Connected</span>
              ) : (
                <span className="text-[9px] px-2 py-0.5 border border-[#64748b]/30 text-[#64748b] bg-[#64748b]/5 rounded-sm uppercase tracking-widest">Not Configured</span>
              )}
            </div>

            {discordStatus && (
              <div className={`text-[10px] px-2 py-1 border rounded-sm ${discordStatus.includes('Error') ? 'border-red-400/30 text-red-400 bg-red-400/5' : 'border-emerald-400/30 text-emerald-400 bg-emerald-400/5'}`}>
                {discordStatus}
              </div>
            )}

            {/* State: No token */}
            {!discord?.has_token && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-[#94a3b8] leading-relaxed">Connect a Discord bot to this agent. Create a bot at the <span className="text-[#7c3aed]">Discord Developer Portal</span> and enable the <span className="text-white font-mono text-[10px]">Message Content</span> intent.</p>
                <input
                  type="password"
                  value={discordTokenInput}
                  onChange={e => setDiscordTokenInput(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#7c3aed] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="Bot token from Developer Portal"
                />
                <button
                  onClick={async () => {
                    if (!discordTokenInput.trim() || !activeAgent) return;
                    setDiscordStatus(null);
                    try {
                      const res = await fetch(`${apiBase}/agents/${activeAgent}/channels/discord/token`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: discordTokenInput })
                      });
                      const data = await res.json();
                      if (data.success) {
                        setDiscordStatus('Token saved. Restart the gateway to activate the bot.');
                        setDiscordTokenInput('');
                        refreshChannels();
                      } else {
                        setDiscordStatus(`Error: ${data.error}`);
                      }
                    } catch (err) { setDiscordStatus(`Error: ${err}`); }
                  }}
                  disabled={!discordTokenInput.trim()}
                  className="bg-[#7c3aed] hover:bg-[#9461fb] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold shadow-[0_0_12px_rgba(124,58,237,0.3)] transition-all self-start"
                >
                  Save Token
                </button>
              </div>
            )}

            {/* State: Token saved */}
            {discord?.has_token && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-emerald-400 leading-relaxed">Discord bot is configured. Messages in channels the bot has access to are routed to this agent.</p>
                <button
                  onClick={async () => {
                    if (!activeAgent) return;
                    setDiscordStatus(null);
                    try {
                      const res = await fetch(`${apiBase}/agents/${activeAgent}/channels/discord`, { method: 'DELETE' });
                      const data = await res.json();
                      if (data.success) {
                        setDiscordStatus('Discord disconnected. Restart gateway to fully remove.');
                        refreshChannels();
                      } else {
                        setDiscordStatus(`Error: ${data.error}`);
                      }
                    } catch (err) { setDiscordStatus(`Error: ${err}`); }
                  }}
                  className="bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 text-red-400 text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold transition-all self-start"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>

          {/* Slack Card - Coming Soon */}
          <div className="border border-[#1e304f] bg-[#0d1522] p-5 rounded-sm flex flex-col gap-3 opacity-50">
            <div className="flex items-center gap-2">
              <Radio size={16} className="text-[#e01e5a]" />
              <span className="text-white text-sm font-bold tracking-wide">Slack</span>
            </div>
            <p className="text-[11px] text-[#64748b]">Coming soon</p>
          </div>

          {/* WhatsApp Card */}
          <div className="border border-[#1e304f] bg-[#0d1522] p-5 rounded-sm flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Radio size={16} className="text-[#25d366]" />
                <span className="text-white text-sm font-bold tracking-wide">WhatsApp</span>
              </div>
              {whatsapp?.has_token ? (
                <span className="text-[9px] px-2 py-0.5 border border-emerald-400/30 text-emerald-400 bg-emerald-400/5 rounded-sm uppercase tracking-widest">Connected</span>
              ) : (
                <span className="text-[9px] px-2 py-0.5 border border-[#64748b]/30 text-[#64748b] bg-[#64748b]/5 rounded-sm uppercase tracking-widest">Not Configured</span>
              )}
            </div>

            {waStatus && (
              <div className={`text-[10px] px-2 py-1 border rounded-sm ${waStatus.includes('Error') ? 'border-red-400/30 text-red-400 bg-red-400/5' : 'border-emerald-400/30 text-emerald-400 bg-emerald-400/5'}`}>
                {waStatus}
              </div>
            )}

            {/* State: Not configured */}
            {!whatsapp?.has_token && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-[#94a3b8] leading-relaxed">Connect WhatsApp via <span className="text-[#25d366]">Twilio</span>. You need your Account SID, Auth Token, and a WhatsApp-enabled sender number.</p>
                <input
                  type="text"
                  value={waAccountSid}
                  onChange={e => setWaAccountSid(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#25d366] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="Twilio Account SID"
                />
                <input
                  type="password"
                  value={waAuthToken}
                  onChange={e => setWaAuthToken(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#25d366] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="Twilio Auth Token"
                />
                <input
                  type="text"
                  value={waFromNumber}
                  onChange={e => setWaFromNumber(e.target.value)}
                  className="w-full bg-[#090d14] border border-[#1e304f] focus:border-[#25d366] outline-none px-3 py-1.5 text-xs text-white font-mono"
                  placeholder="Sender number (e.g. +14155238886)"
                />
                <button
                  onClick={async () => {
                    if (!waAccountSid.trim() || !waAuthToken.trim() || !waFromNumber.trim() || !activeAgent) return;
                    setWaStatus(null);
                    try {
                      const res = await fetch(`${apiBase}/agents/${activeAgent}/channels/whatsapp/config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ account_sid: waAccountSid, auth_token: waAuthToken, from_number: waFromNumber })
                      });
                      const data = await res.json();
                      if (data.success) {
                        setWaStatus('WhatsApp configured. Restart the gateway to activate.');
                        setWaAccountSid('');
                        setWaAuthToken('');
                        setWaFromNumber('');
                        refreshChannels();
                      } else {
                        setWaStatus(`Error: ${data.error}`);
                      }
                    } catch (err) { setWaStatus(`Error: ${err}`); }
                  }}
                  disabled={!waAccountSid.trim() || !waAuthToken.trim() || !waFromNumber.trim()}
                  className="bg-[#25d366] hover:bg-[#2ee676] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold shadow-[0_0_12px_rgba(37,211,102,0.3)] transition-all self-start"
                >
                  Save Config
                </button>
              </div>
            )}

            {/* State: Configured */}
            {whatsapp?.has_token && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-emerald-400 leading-relaxed">WhatsApp (Twilio) is configured. Incoming messages on the webhook are routed to this agent.</p>
                <button
                  onClick={async () => {
                    if (!activeAgent) return;
                    setWaStatus(null);
                    try {
                      const res = await fetch(`${apiBase}/agents/${activeAgent}/channels/whatsapp`, { method: 'DELETE' });
                      const data = await res.json();
                      if (data.success) {
                        setWaStatus('WhatsApp disconnected. Restart gateway to fully remove.');
                        refreshChannels();
                      } else {
                        setWaStatus(`Error: ${data.error}`);
                      }
                    } catch (err) { setWaStatus(`Error: ${err}`); }
                  }}
                  className="bg-red-500/20 hover:bg-red-500/30 border border-red-400/30 text-red-400 text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold transition-all self-start"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
