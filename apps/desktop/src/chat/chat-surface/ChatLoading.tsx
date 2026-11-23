import { MoxxyMark } from '@/components/MoxxyMark';

export function ChatLoading({ label = 'Loading conversation…' }: { readonly label?: string }): JSX.Element {
  return (
    <div className="chat-preparing" role="status" aria-atomic="true">
      <span aria-hidden="true"><MoxxyMark size={96} className="moxxy-avatar-loader chat-preparing-mark" /></span>
      <h2>{label}</h2>
    </div>
  );
}
