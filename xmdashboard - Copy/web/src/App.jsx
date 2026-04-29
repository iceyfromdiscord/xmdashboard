import React, { useState, useEffect, useMemo } from 'react';
import { io } from 'socket.io-client';
import { Settings, Trash2, Cpu, Clock, Activity, Zap } from 'lucide-react';

const SOCKET_URL = 'http://localhost:3001';

function App() {
  const [miners, setMiners] = useState({});
  const [history, setHistory] = useState([]);
  const [editingMiner, setEditingMiner] = useState(null);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const s = io(SOCKET_URL);
    setSocket(s);

    s.on('miners_update', (data) => {
      setMiners(data);
    });

    s.on('history_update', (data) => {
      setHistory(data);
    });

    return () => s.disconnect();
  }, []);

  const totalHashrate = useMemo(() => {
    return Object.values(miners).reduce((acc, m) => acc + (m.status === 'online' ? m.hashrate : 0), 0);
  }, [miners]);

  const onlineMiners = useMemo(() => {
    return Object.values(miners).filter(m => m.status === 'online').length;
  }, [miners]);

  const handleUpdateConfig = (config) => {
    if (socket) {
      socket.emit('update_config', { id: editingMiner.id, ...config });
      setEditingMiner(null);
    }
  };

  const handleRemoveMiner = (id) => {
    if (socket && window.confirm('Are you sure you want to remove this miner?')) {
      socket.emit('remove_miner', id);
    }
  };

  const formatHashrate = (hr) => {
    if (hr > 1000000) return (hr / 1000000).toFixed(2) + ' MH/s';
    if (hr > 1000) return (hr / 1000).toFixed(2) + ' kH/s';
    return hr.toFixed(2) + ' H/s';
  };

  const formatUptime = (seconds) => {
    const d = Math.floor(seconds / (3600*24));
    const h = Math.floor(seconds % (3600*24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>XMRig Dashboard</h1>
        <div className="stats-container">
          <div className="stat-box">
            <span className="stat-label">Total Hashrate</span>
            <span className="stat-value">{formatHashrate(totalHashrate)}</span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Active Miners</span>
            <span className="stat-value">{onlineMiners} / {Object.keys(miners).length}</span>
          </div>
        </div>
      </header>

      <div className="miners-grid">
        {Object.values(miners).length === 0 ? (
          <div className="empty-state">
            <Cpu size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
            <h2>No miners connected</h2>
            <p>Run the bash script on your rigs to connect them.</p>
          </div>
        ) : (
          Object.values(miners).map(miner => (
            <div key={miner.id} className={`miner-card ${miner.status}`}>
              <div className="miner-header">
                <div>
                  <div className="miner-name">{miner.worker || miner.id}</div>
                  <div className={`status-badge ${miner.status}`}>
                    <span className={`status-dot ${miner.status}`}></span>
                    {miner.status}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--accent-blue)' }}>
                    {formatHashrate(miner.hashrate)}
                  </div>
                </div>
              </div>

              <div className="miner-stats">
                <div className="miner-stat-item">
                  <span className="miner-stat-label"><Activity size={14} style={{display:'inline', marginRight:4}}/>ID</span>
                  <span className="miner-stat-val" style={{fontSize: '0.875rem'}}>{miner.id}</span>
                </div>
                <div className="miner-stat-item">
                  <span className="miner-stat-label"><Clock size={14} style={{display:'inline', marginRight:4}}/>Uptime</span>
                  <span className="miner-stat-val">{formatUptime(miner.uptime)}</span>
                </div>
              </div>

              <div className="miner-pool">
                <Zap size={16} color="var(--accent-orange)" />
                <span style={{flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                  {miner.pool || 'No pool configured'}
                </span>
                {miner.tls && <span style={{fontSize: '0.75rem', background: 'var(--accent-green)', color: '#000', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold'}}>TLS</span>}
              </div>

              <div className="miner-actions">
                <button style={{flex: 1}} onClick={() => setEditingMiner(miner)}>
                  <Settings size={16} /> Configure
                </button>
                <button className="danger" onClick={() => handleRemoveMiner(miner.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {editingMiner && (
        <ConfigModal 
          miner={editingMiner} 
          onClose={() => setEditingMiner(null)} 
          onSave={handleUpdateConfig} 
        />
      )}
    </div>
  );
}

function ConfigModal({ miner, onClose, onSave }) {
  const [pool, setPool] = useState(miner.pool || '');
  const [worker, setWorker] = useState(miner.worker || '');
  const [pass, setPass] = useState('');
  const [tls, setTls] = useState(miner.tls || false);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({ pool, worker, pass, tls });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Configure Miner</h2>
          <button onClick={onClose} style={{background: 'transparent', border: 'none'}}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Pool URL (e.g., pool.minexmr.com:4444)</label>
            <input 
              type="text" 
              value={pool} 
              onChange={e => setPool(e.target.value)} 
              placeholder="pool.example.com:3333" 
            />
          </div>
          <div className="form-group">
            <label>Worker Name / Wallet Address</label>
            <input 
              type="text" 
              value={worker} 
              onChange={e => setWorker(e.target.value)} 
            />
          </div>
          <div className="form-group">
            <label>Password (Optional)</label>
            <input 
              type="password" 
              value={pass} 
              onChange={e => setPass(e.target.value)} 
              placeholder="x"
            />
          </div>
          <div className="form-group">
            <label className="checkbox-label">
              <input 
                type="checkbox" 
                checked={tls} 
                onChange={e => setTls(e.target.checked)} 
              />
              Enable TLS
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary">Apply Configuration</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
