// src/App.js
import React from 'react';
import FileUpload from './components/FileUpload';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Cycling AI Assistant</h1>
        <p>Upload your cycling data to get started with intelligent route recommendations and predictive maintenance insights.</p>
      </header>
      
      <main className="App-main">
        <FileUpload />
      </main>
      
      <footer className="App-footer">
        <p>Built with React and powered by AI for smarter cycling experiences.</p>
      </footer>
    </div>
  );
}

export default App;