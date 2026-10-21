import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it} from 'vitest';
import App from './App';
describe('HR Pulse',()=>{it('shows login',()=>{render(<App/>);expect(screen.getByText('Sign in to your workspace')).not.toBeNull()});it('toggles password visibility',()=>{render(<App/>);const password=screen.getByLabelText('Password');expect(password.getAttribute('type')).toBe('password');fireEvent.click(screen.getByRole('button',{name:'Toggle password'}));expect(password.getAttribute('type')).toBe('text')})});
