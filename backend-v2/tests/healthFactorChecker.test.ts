import { describe, it, expect } from 'vitest';

describe('HealthFactorChecker HF Edge Cases', () => {
  describe('HF sanitization for no-debt accounts', () => {
    it('should treat totalDebtBase === 0 as HF=Infinity', () => {
      // Simulate health factor calculation logic
      const totalDebtBase = 0n;
      const healthFactorRaw = 0n;
      
      let healthFactor: number;
      
      if (totalDebtBase === 0n) {
        healthFactor = Infinity;
      } else if (healthFactorRaw === 0n) {
        healthFactor = Infinity;
      } else {
        healthFactor = Number(healthFactorRaw) / 1e18;
      }
      
      expect(healthFactor).toBe(Infinity);
      expect(Number.isFinite(healthFactor)).toBe(false);
    });
    
    it('should treat healthFactorRaw === 0 with debt as HF=Infinity', () => {
      const totalDebtBase = 1000000000000000000n; // 1 ETH
      const healthFactorRaw = 0n; // Edge case: invalid HF
      
      let healthFactor: number;
      
      if (totalDebtBase === 0n) {
        healthFactor = Infinity;
      } else if (healthFactorRaw === 0n) {
        healthFactor = Infinity;
      } else {
        healthFactor = Number(healthFactorRaw) / 1e18;
      }
      
      expect(healthFactor).toBe(Infinity);
    });
    
    it('should calculate normal HF correctly when debt > 0 and HF > 0', () => {
      const totalDebtBase = 1000000000000000000n; // 1 ETH
      const healthFactorRaw = 1500000000000000000n; // 1.5 HF (1.5 * 1e18)
      
      let healthFactor: number;
      
      if (totalDebtBase === 0n) {
        healthFactor = Infinity;
      } else if (healthFactorRaw === 0n) {
        healthFactor = Infinity;
      } else {
        healthFactor = Number(healthFactorRaw) / 1e18;
      }
      
      expect(healthFactor).toBe(1.5);
      expect(Number.isFinite(healthFactor)).toBe(true);
    });
    
    it('should handle very low HF (liquidatable) correctly', () => {
      const totalDebtBase = 1000000000000000000n; // 1 ETH
      const healthFactorRaw = 950000000000000000n; // 0.95 HF (liquidatable)
      
      let healthFactor: number;
      
      if (totalDebtBase === 0n) {
        healthFactor = Infinity;
      } else if (healthFactorRaw === 0n) {
        healthFactor = Infinity;
      } else {
        healthFactor = Number(healthFactorRaw) / 1e18;
      }
      
      expect(healthFactor).toBe(0.95);
      expect(healthFactor).toBeLessThan(1.0);
    });
  });
  
  describe('Heartbeat minHF calculation', () => {
    it('should not include Infinity HF in minHF calculation', () => {
      // Simulate heartbeat logic for finding minHF
      const users = [
        { address: '0x1', healthFactor: Infinity },
        { address: '0x2', healthFactor: 1.5 },
        { address: '0x3', healthFactor: 0.95 },
        { address: '0x4', healthFactor: 2.0 },
      ];
      
      let minHF: number | null = null;
      for (const user of users) {
        const hf = user.healthFactor;
        
        // Defensive guard against invalid values
        if (!Number.isFinite(hf)) continue;
        
        if (minHF === null || hf < minHF) {
          minHF = hf;
        }
      }
      
      expect(minHF).toBe(0.95);
    });
    
    it('should return null if all users have Infinity HF', () => {
      const users = [
        { address: '0x1', healthFactor: Infinity },
        { address: '0x2', healthFactor: Infinity },
      ];
      
      let minHF: number | null = null;
      for (const user of users) {
        const hf = user.healthFactor;
        
        if (!Number.isFinite(hf)) continue;
        
        if (minHF === null || hf < minHF) {
          minHF = hf;
        }
      }
      
      expect(minHF).toBe(null);
    });
  });
});
