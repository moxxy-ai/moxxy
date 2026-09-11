import { expect, it } from 'vitest';
import { computerPanel } from './panel-model';

const scope={workspaceId:'workspace',sessionId:'session',turnId:'turn'};
const snapshot={...scope,state:'waiting_for_focus' as const,windowId:'window'};
it('only presents controls for the exact workspace/session/turn', () => {
  expect(computerPanel(scope,{workspaceId:'other',turns:[snapshot]})).toBeNull();
  expect(computerPanel({...scope,turnId:'other'},{workspaceId:'workspace',turns:[snapshot]})).toBeNull();
  expect(computerPanel(scope,{workspaceId:'workspace',turns:[{...snapshot,sessionId:'other'}]})).toBeNull();
  expect(computerPanel(scope,{workspaceId:'workspace',turns:[snapshot]})).toMatchObject({
    label:'Waiting for the target window',canResume:true,canPause:true,canStop:true,
  });
});
it('does not offer automatic resume or any control after Stop', () => {
  const view=(state:typeof snapshot.state|'paused_by_user'|'stopped'|'failed')=>computerPanel(scope,{workspaceId:'workspace',turns:[{...snapshot,state}]});
  expect(view('paused_by_user')).toMatchObject({label:'Paused by you',canPause:false,canResume:true,canStop:true});
  expect(view('stopped')).toMatchObject({canPause:false,canResume:false,canStop:false});
  expect(view('failed')).toMatchObject({canPause:false,canResume:false,canStop:false});
});
