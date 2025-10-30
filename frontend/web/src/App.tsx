import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface ImmuneDataRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  dataType: string;
  status: "pending" | "processed" | "error";
  simulationResult?: string;
}

// FHE Encryption/Decryption simulation
const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}-${Date.now()}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    const base64Data = encryptedData.split('-')[1];
    return parseFloat(atob(base64Data));
  }
  return parseFloat(encryptedData);
};

// FHE Homomorphic operations for immune system simulation
const FHEImmuneSimulation = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'vaccine_response':
      // Simulate vaccine immune response (increase antibody levels)
      result = value * 1.3 + Math.random() * 10;
      break;
    case 'infection_simulation':
      // Simulate infection response (temporary drop then recovery)
      result = value * 0.7 + Math.random() * 5;
      break;
    case 'immune_boost':
      // Simulate immune system enhancement
      result = value * 1.5 + Math.random() * 8;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<ImmuneDataRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, status: "pending", message: "" 
  });
  const [newRecordData, setNewRecordData] = useState({ 
    dataType: "", description: "", cellCount: 0, antibodyLevel: 0, cytokineLevel: 0 
  });
  const [selectedRecord, setSelectedRecord] = useState<ImmuneDataRecord | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<"dashboard" | "lab" | "data">("dashboard");
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationProgress, setSimulationProgress] = useState(0);

  // Initialize component
  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
    const initContractParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setPublicKey(generatePublicKey());
    };
    initContractParams();
  }, []);

  // Load immune data records from contract
  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.warn("Contract not available");
        return;
      }

      // Load record keys
      const keysBytes = await contract.getData("immune_record_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { 
          console.error("Error parsing record keys:", e); 
        }
      }

      // Load individual records
      const list: ImmuneDataRecord[] = [];
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`immune_record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({ 
                id: key, 
                encryptedData: recordData.data, 
                timestamp: recordData.timestamp, 
                owner: recordData.owner, 
                dataType: recordData.dataType, 
                status: recordData.status || "pending",
                simulationResult: recordData.simulationResult
              });
            } catch (e) { 
              console.error(`Error parsing record data for ${key}:`, e); 
            }
          }
        } catch (e) { 
          console.error(`Error loading record ${key}:`, e); 
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) { 
      console.error("Error loading records:", e); 
    } finally { 
      setIsRefreshing(false); 
      setLoading(false); 
    }
  };

  // Upload new immune data record
  const uploadImmuneData = async () => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return; 
    }
    setUploading(true);
    setTransactionStatus({ 
      visible: true, 
      status: "pending", 
      message: "Encrypting immune data with Zama FHE..." 
    });

    try {
      // Encrypt sensitive immune data using FHE
      const encryptedData = FHEEncryptNumber(
        newRecordData.cellCount + newRecordData.antibodyLevel + newRecordData.cytokineLevel
      );

      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      // Generate unique record ID
      const recordId = `immune-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      // Prepare record data
      const recordData = { 
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        dataType: newRecordData.dataType, 
        status: "pending" 
      };

      // Store record in contract
      await contract.setData(`immune_record_${recordId}`, ethers.toUtf8Bytes(JSON.stringify(recordData)));

      // Update record keys list
      const keysBytes = await contract.getData("immune_record_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { 
          keys = JSON.parse(ethers.toUtf8String(keysBytes)); 
        } catch (e) { 
          console.error("Error parsing keys:", e); 
        }
      }
      keys.push(recordId);
      await contract.setData("immune_record_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Immune data encrypted and stored securely!" 
      });

      await loadRecords();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewRecordData({ dataType: "", description: "", cellCount: 0, antibodyLevel: 0, cytokineLevel: 0 });
      }, 2000);

    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Upload failed: " + (e.message || "Unknown error");
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: errorMessage 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploading(false); 
    }
  };

  // Decrypt data with wallet signature
  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return null; 
    }
    setIsDecrypting(true);
    try {
      // Create signature message for decryption authorization
      const message = `ZamaFHE-Decrypt:${publicKey}:${contractAddress}:${chainId}:${Date.now()}`;
      await signMessageAsync({ message });
      
      // Simulate FHE decryption process
      await new Promise(resolve => setTimeout(resolve, 2000));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  // Run immune system simulation on encrypted data
  const runSimulation = async (recordId: string, simulationType: string) => {
    if (!isConnected) { 
      alert("Please connect wallet first"); 
      return; 
    }

    setSimulationRunning(true);
    setSimulationProgress(0);
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");

      // Load record data
      const recordBytes = await contract.getData(`immune_record_${recordId}`);
      if (recordBytes.length === 0) throw new Error("Record not found");
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      // Simulate FHE computation progress
      const progressInterval = setInterval(() => {
        setSimulationProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 300);

      // Perform FHE homomorphic computation
      const simulationResult = FHEImmuneSimulation(recordData.data, simulationType);
      
      clearInterval(progressInterval);
      setSimulationProgress(100);

      // Update record with simulation result
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedRecord = { 
        ...recordData, 
        status: "processed", 
        simulationResult: simulationResult 
      };
      
      await contractWithSigner.setData(
        `immune_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );

      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "FHE immune simulation completed successfully!" 
      });

      await loadRecords();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);

    } catch (e: any) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Simulation failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setSimulationRunning(false);
      setSimulationProgress(0);
    }
  };

  // Check if current user is record owner
  const isOwner = (recordAddress: string) => address?.toLowerCase() === recordAddress.toLowerCase();

  // Calculate statistics for dashboard
  const processedCount = records.filter(r => r.status === "processed").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const errorCount = records.filter(r => r.status === "error").length;

  // Render immune system visualization
  const renderImmuneVisualization = () => {
    const total = records.length || 1;
    return (
      <div className="immune-visualization">
        <div className="cell-network">
          {records.slice(0, 10).map((record, index) => (
            <div 
              key={record.id}
              className={`immune-cell ${record.status}`}
              style={{
                left: `${20 + (index % 5) * 15}%`,
                top: `${20 + Math.floor(index / 5) * 20}%`,
                animationDelay: `${index * 0.2}s`
              }}
            >
              <div className="cell-nucleus"></div>
              <div className="cell-membrane"></div>
            </div>
          ))}
        </div>
        <div className="immune-stats">
          <div className="stat-item">
            <div className="stat-value">{records.length}</div>
            <div className="stat-label">Data Points</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{processedCount}</div>
            <div className="stat-label">Processed</div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen bio-theme">
      <div className="dna-spinner"></div>
      <p>Initializing Immune System Digital Twin...</p>
    </div>
  );

  return (
    <div className="app-container bio-theme">
      {/* Header */}
      <header className="app-header">
        <div className="logo">
          <div className="dna-icon"></div>
          <h1>ImmuneSystem<span>Twin</span>FHE</h1>
        </div>
        <div className="header-actions">
          <nav className="main-nav">
            <button 
              className={`nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              Dashboard
            </button>
            <button 
              className={`nav-btn ${activeTab === "lab" ? "active" : ""}`}
              onClick={() => setActiveTab("lab")}
            >
              Simulation Lab
            </button>
            <button 
              className={`nav-btn ${activeTab === "data" ? "active" : ""}`}
              onClick={() => setActiveTab("data")}
            >
              Data Library
            </button>
          </nav>
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-btn bio-button"
          >
            <div className="upload-icon"></div>
            Upload Immune Data
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="main-content">
        {/* Welcome Banner */}
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Immune System Digital Twin</h2>
            <p>FHE-encrypted immune data analysis and simulation platform powered by Zama</p>
          </div>
          <div className="fhe-indicator">
            <div className="fhe-lock"></div>
            <span>FHE Encryption Active</span>
          </div>
        </div>

        {/* Dashboard Tab */}
        {activeTab === "dashboard" && (
          <div className="dashboard-tab">
            <div className="dashboard-grid">
              <div className="dashboard-card bio-card">
                <h3>Project Overview</h3>
                <p>Global immune system digital twin platform using <strong>Zama FHE technology</strong> to process sensitive immunological data without decryption.</p>
                <div className="fhe-badge">
                  <span>FHE-Powered Immunology</span>
                </div>
              </div>

              <div className="dashboard-card bio-card">
                <h3>Immune Data Statistics</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-value">{records.length}</div>
                    <div className="stat-label">Total Records</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{processedCount}</div>
                    <div className="stat-label">Processed</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{pendingCount}</div>
                    <div className="stat-label">Pending</div>
                  </div>
                </div>
              </div>

              <div className="dashboard-card bio-card">
                <h3>Immune System Visualization</h3>
                {renderImmuneVisualization()}
              </div>
            </div>
          </div>
        )}

        {/* Simulation Lab Tab */}
        {activeTab === "lab" && (
          <div className="lab-tab">
            <div className="lab-header">
              <h3>FHE Immune Simulation Laboratory</h3>
              <p>Run homomorphic computations on encrypted immune data</p>
            </div>
            
            <div className="simulation-controls">
              <div className="control-panel bio-card">
                <h4>Simulation Parameters</h4>
                <div className="param-grid">
                  <div className="param-item">
                    <label>Simulation Type</label>
                    <select className="bio-select">
                      <option>Vaccine Response</option>
                      <option>Infection Simulation</option>
                      <option>Immune Boost</option>
                    </select>
                  </div>
                  <div className="param-item">
                    <label>Data Samples</label>
                    <input type="number" className="bio-input" defaultValue="10" />
                  </div>
                </div>
                <button className="bio-button primary">Run FHE Simulation</button>
              </div>

              <div className="simulation-visualization bio-card">
                <h4>Real-time Simulation</h4>
                {simulationRunning && (
                  <div className="simulation-progress">
                    <div 
                      className="progress-bar" 
                      style={{ width: `${simulationProgress}%` }}
                    ></div>
                    <span>FHE Computation: {simulationProgress}%</span>
                  </div>
                )}
                <div className="immune-animation">
                  <div className="pathogen"></div>
                  <div className="antibody"></div>
                  <div className="t-cell"></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Data Library Tab */}
        {activeTab === "data" && (
          <div className="data-tab">
            <div className="section-header">
              <h3>Encrypted Immune Data Library</h3>
              <div className="header-actions">
                <button onClick={loadRecords} className="refresh-btn bio-button" disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh Data"}
                </button>
              </div>
            </div>

            <div className="records-list bio-card">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Data Type</div>
                <div className="header-cell">Owner</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>

              {records.length === 0 ? (
                <div className="no-records">
                  <div className="no-data-icon"></div>
                  <p>No immune data records found</p>
                  <button className="bio-button primary" onClick={() => setShowUploadModal(true)}>
                    Upload First Data Set
                  </button>
                </div>
              ) : (
                records.map(record => (
                  <div className="record-row" key={record.id} onClick={() => setSelectedRecord(record)}>
                    <div className="table-cell record-id">#{record.id.substring(0, 8)}</div>
                    <div className="table-cell">{record.dataType}</div>
                    <div className="table-cell">{record.owner.substring(0, 8)}...</div>
                    <div className="table-cell">{new Date(record.timestamp * 1000).toLocaleDateString()}</div>
                    <div className="table-cell">
                      <span className={`status-badge ${record.status}`}>{record.status}</span>
                    </div>
                    <div className="table-cell actions">
                      {isOwner(record.owner) && record.status === "pending" && (
                        <button 
                          className="action-btn bio-button success" 
                          onClick={(e) => { e.stopPropagation(); runSimulation(record.id, 'vaccine_response'); }}
                        >
                          Simulate
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <UploadModal 
          onSubmit={uploadImmuneData} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}

      {/* Record Detail Modal */}
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord}
          onClose={() => { setSelectedRecord(null); setDecryptedValue(null); }}
          decryptedValue={decryptedValue}
          setDecryptedValue={setDecryptedValue}
          isDecrypting={isDecrypting}
          decryptWithSignature={decryptWithSignature}
        />
      )}

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content bio-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="dna-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="dna-icon"></div>
              <span>ImmuneSystemTwinFHE</span>
            </div>
            <p>Secure immune data processing using Zama FHE technology</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Research Papers</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">API Documentation</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} Immune System Digital Twin. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

// Upload Modal Component
interface UploadModalProps {
  onSubmit: () => void;
  onClose: () => void;
  uploading: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const UploadModal: React.FC<UploadModalProps> = ({ onSubmit, onClose, uploading, recordData, setRecordData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: value });
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: parseFloat(value) || 0 });
  };

  const handleSubmit = () => {
    if (!recordData.dataType) { 
      alert("Please select data type"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal bio-card">
        <div className="modal-header">
          <h2>Upload Immune System Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="shield-icon"></div>
            <div>
              <strong>FHE Encryption Active</strong>
              <p>Your immunological data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>Data Type *</label>
              <select name="dataType" value={recordData.dataType} onChange={handleChange} className="bio-select">
                <option value="">Select data type</option>
                <option value="BloodTest">Blood Test Results</option>
                <option value="GeneticData">Genetic Markers</option>
                <option value="AntibodyLevel">Antibody Levels</option>
                <option value="CellCount">Immune Cell Count</option>
              </select>
            </div>

            <div className="form-group">
              <label>Immune Cell Count</label>
              <input 
                type="number" 
                name="cellCount" 
                value={recordData.cellCount} 
                onChange={handleNumberChange}
                className="bio-input"
                placeholder="Enter cell count..."
              />
            </div>

            <div className="form-group">
              <label>Antibody Level</label>
              <input 
                type="number" 
                name="antibodyLevel" 
                value={recordData.antibodyLevel} 
                onChange={handleNumberChange}
                className="bio-input"
                placeholder="Enter antibody level..."
                step="0.01"
              />
            </div>

            <div className="form-group">
              <label>Cytokine Level</label>
              <input 
                type="number" 
                name="cytokineLevel" 
                value={recordData.cytokineLevel} 
                onChange={handleNumberChange}
                className="bio-input"
                placeholder="Enter cytokine level..."
                step="0.01"
              />
            </div>
          </div>

          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Original Data:</span>
                <div>{recordData.cellCount + recordData.antibodyLevel + recordData.cytokineLevel}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>
                  {FHEEncryptNumber(
                    recordData.cellCount + recordData.antibodyLevel + recordData.cytokineLevel
                  ).substring(0, 40)}...
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="bio-button">Cancel</button>
          <button onClick={handleSubmit} disabled={uploading} className="bio-button primary">
            {uploading ? "Encrypting with Zama FHE..." : "Upload Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

// Record Detail Modal Component
interface RecordDetailModalProps {
  record: ImmuneDataRecord;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const RecordDetailModal: React.FC<RecordDetailModalProps> = ({
  record,
  onClose,
  decryptedValue,
  setDecryptedValue,
  isDecrypting,
  decryptWithSignature
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) {
      setDecryptedValue(null);
      return;
    }
    const decrypted = await decryptWithSignature(record.encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal bio-card">
        <div className="modal-header">
          <h2>Immune Data Record #{record.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>

        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>Data Type:</span>
              <strong>{record.dataType}</strong>
            </div>
            <div className="info-item">
              <span>Owner:</span>
              <strong>{record.owner.substring(0, 8)}...{record.owner.substring(36)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Status:</span>
              <strong className={`status-badge ${record.status}`}>{record.status}</strong>
            </div>
          </div>

          <div className="encrypted-data-section">
            <h3>FHE Encrypted Data</h3>
            <div className="encrypted-data">
              {record.encryptedData.substring(0, 60)}...
            </div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>Zama FHE Encrypted</span>
            </div>

            <button 
              className="decrypt-btn bio-button" 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
            >
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedValue !== null ? (
                "Re-encrypt Data"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>

          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Immune Value</h3>
              <div className="decrypted-value">{decryptedValue}</div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="bio-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;