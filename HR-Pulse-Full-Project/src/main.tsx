import FourDigitYears from './FourDigitYears';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import UpdateBanner from './UpdateBanner';
import './styles.css';
import {restoreApproved} from './salaryProposals';
restoreApproved();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><FourDigitYears><App /><UpdateBanner /></FourDigitYears></React.StrictMode>);
