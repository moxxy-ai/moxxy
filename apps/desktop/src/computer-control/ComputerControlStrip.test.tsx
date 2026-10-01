import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { ComputerControlStrip } from './ComputerControlStrip';
import type { ComputerPanelView } from './panel-model';

const view:ComputerPanelView={label:'Controlling the target window',icon:'play',target:'TextEdit — Notes.txt',canTakeOver:true,canResume:false,canStop:true};

it('presents accessible human controls without executing its own orchestration', () => {
  const commands:string[]=[];
  render(<ComputerControlStrip view={{...view,label:'Waiting for the target window',canResume:true}}
    busy={false} error={null} onCommand={command=>commands.push(command)} />);
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for the target window');
  fireEvent.click(screen.getByRole('button',{name:'Resume Computer Use'}));
  fireEvent.click(screen.getByRole('button',{name:'Stop Computer Use'}));
  expect(commands).toEqual(['resume','stop']);
});
it('shows which app and window the agent controls next to the state', () => {
  render(<ComputerControlStrip view={view} busy={false} error={null} onCommand={()=>undefined} />);
  expect(screen.getByRole('status')).toHaveTextContent('Controlling the target window');
  expect(screen.getByText('TextEdit — Notes.txt')).toBeInTheDocument();
});
it('lets the user take over and stop from the keyboard alone', async () => {
  const commands:string[]=[];
  const user=userEvent.setup();
  render(<ComputerControlStrip view={view} busy={false} error={null} onCommand={command=>commands.push(command)} />);
  await user.tab();
  expect(screen.getByRole('button',{name:'Take over from Computer Use'})).toHaveFocus();
  await user.keyboard('{Enter}');
  await user.tab();
  expect(screen.getByRole('button',{name:'Stop Computer Use'})).toHaveFocus();
  await user.keyboard(' ');
  expect(commands).toEqual(['takeover','stop']);
});
it('keeps Stop available while another command is in flight', () => {
  render(<ComputerControlStrip view={view} busy error={null} onCommand={()=>undefined} />);
  expect(screen.getByRole('button',{name:'Take over from Computer Use'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Stop Computer Use'})).toBeEnabled();
});
