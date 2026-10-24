import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Customer from './pages/Customer.jsx';
import Kitchen from './pages/Kitchen.jsx';
import Admin from './pages/Admin.jsx';
import Cashier from './pages/Cashier.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/t/:token" element={<Customer />} />
        <Route path="/kitchen" element={<Kitchen />} />
        <Route path="/cashier" element={<Cashier />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
