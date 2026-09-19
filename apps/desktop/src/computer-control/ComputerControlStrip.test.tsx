import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ComputerControlStrip } from './ComputerControlStrip';

it('presents accessible human controls without executing its own orchestration', () => {
  const commands:string[]=[];
  render(<ComputerControlStrip view={{label:'Waiting for the target window',canPause:true,canResume:true,canStop:true}}
    busy={false} error={null} onCommand={command=>commands.push(command)} />);
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for the target window');
  fireEvent.click(screen.getByRole('button',{name:'Resume Computer Use'}));
  fireEvent.click(screen.getByRole('button',{name:'Stop Computer Use'}));
  expect(commands).toEqual(['resume','stop']);
});
