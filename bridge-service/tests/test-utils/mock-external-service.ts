/**
 * Mock external service for testing external function calls
 */

import express from 'express';
import { setTimeout } from 'node:timers/promises';

export class MockExternalService {
  private app: express.Application;
  private server: any;
  private callCount: number = 0;
  private lastRequest: any = null;
  private responseDelay: number = 0;
  private shouldFail: boolean = false;
  private failureStatus: number = 500;

  constructor(private port: number) {
    this.app = express();
    this.app.use(express.json());
    
    // Mock endpoint for external function calls
    this.app.post('/execute', async (req, res) => {
      this.callCount++;
      this.lastRequest = req.body;
      
      if (this.responseDelay > 0) {
        await setTimeout(this.responseDelay);
      }
      
      if (this.shouldFail) {
        res.status(this.failureStatus).json({
          success: false,
          error: 'Mock failure'
        });
      } else {
        res.json({
          success: true,
          result: req.body.args
        });
      }
    });
  }

  async start(): Promise<void> {
    return new Promise(resolve => {
      this.server = this.app.listen(this.port, () => {
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise(resolve => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  setResponseDelay(ms: number): void {
    this.responseDelay = ms;
  }

  setFailure(shouldFail: boolean, status: number = 500): void {
    this.shouldFail = shouldFail;
    this.failureStatus = status;
  }

  getCallCount(): number {
    return this.callCount;
  }

  getLastRequest(): any {
    return this.lastRequest;
  }

  reset(): void {
    this.callCount = 0;
    this.lastRequest = null;
    this.responseDelay = 0;
    this.shouldFail = false;
    this.failureStatus = 500;
  }
}
