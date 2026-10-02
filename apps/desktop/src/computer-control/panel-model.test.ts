import { expect, it } from 'vitest';
import { computerCursor, computerPanel, usesComputer } from './panel-model';

const scope={workspaceId:'workspace',sessionId:'session',turnId:'turn'};
const snapshot={...scope,state:'waiting_for_focus' as const,windowId:'window'};
it('only presents controls for the exact workspace/session/turn', () => {
  expect(computerPanel(scope,{workspaceId:'other',turns:[snapshot]})).toBeNull();
  expect(computerPanel({...scope,turnId:'other'},{workspaceId:'workspace',turns:[snapshot]})).toBeNull();
  expect(computerPanel(scope,{workspaceId:'workspace',turns:[{...snapshot,sessionId:'other'}]})).toBeNull();
  expect(computerPanel(scope,{workspaceId:'workspace',turns:[snapshot]})).toMatchObject({
    label:'Waiting for the target window',canResume:true,canTakeOver:true,canStop:true,
  });
});
it('does not offer automatic resume or any control after Stop', () => {
  const view=(state:typeof snapshot.state|'paused_by_user'|'stopped'|'failed')=>computerPanel(scope,{workspaceId:'workspace',turns:[{...snapshot,state}]});
  expect(view('paused_by_user')).toMatchObject({label:'Paused by you',canTakeOver:false,canResume:true,canStop:true});
  expect(view('stopped')).toMatchObject({canTakeOver:false,canResume:false,canStop:false});
  expect(view('failed')).toMatchObject({canTakeOver:false,canResume:false,canStop:false});
});
it('names the app and window under control, and nothing when no target is known', () => {
  const view=(target?:{app:string;window:string|null})=>computerPanel(scope,{workspaceId:'workspace',turns:[{...snapshot,...(target ? {target} : {})}]});
  expect(view({app:'TextEdit',window:'Notes.txt'})).toMatchObject({target:'TextEdit — Notes.txt'});
  expect(view({app:'Calculator',window:null})).toMatchObject({target:'Calculator'});
  expect(view()).toMatchObject({target:null});
});
it('pairs every state with an icon, so the state never rests on colour or text alone', () => {
  const icon=(state:typeof snapshot.state|'foreground'|'paused_by_user'|'stopped')=>computerPanel(scope,{workspaceId:'workspace',turns:[{...snapshot,state}]})?.icon;
  expect(icon('foreground')).toBe('play');
  expect(icon('paused_by_user')).toBe('pause');
  expect(icon('stopped')).toBe('stop');
});
it('watches a turn only when the session has Computer Use tools, on any platform', () => {
  expect(usesComputer([{name:'Read'},{name:'computer_get_app_state'}])).toBe(true);
  expect(usesComputer([{name:'computer_status'}])).toBe(true);
  expect(usesComputer([{name:'Read'},{name:'computerish'}])).toBe(false);
});
it('hands the agent cursor of the exact turn to the live view, and none once the turn has none', () => {
  const cursor={phase:'moving' as const,x:0.25,y:0.5};
  expect(computerCursor(scope,{workspaceId:'workspace',turns:[{...snapshot,cursor}]})).toEqual(cursor);
  expect(computerCursor(scope,{workspaceId:'workspace',turns:[snapshot]})).toBeNull();
  expect(computerCursor({...scope,turnId:'other'},{workspaceId:'workspace',turns:[{...snapshot,cursor}]})).toBeNull();
  expect(computerCursor(scope,null)).toBeNull();
});
