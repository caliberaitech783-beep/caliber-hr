import FourDigitYears from './FourDigitYears';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import {restoreApproved} from './salaryProposals';
restoreApproved();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><FourDigitYears><App /></FourDigitYears></React.StrictMode>);
