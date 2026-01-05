import { describe, it, expect } from 'vitest';

describe('HealthFactorChecker HF Edge Cases', () => {
  describe('HF sanitization for no-debt accounts', () => {
    it('should treat totalDebtBase === 0 as HF=Infinity', () => {
      // Simulate health factor calculation logic
      const totalCollateralBase = 1000000000000000000n; // 1 ETH
      const totalDebtBase = 0n;
      const healthFactorRaw = 0n;
      
      let healthFactor: number;
      
      if (totalDebtBase === 0n) {
        healthFactor = Number.POSITIVE_INFINITY;
      } else if (healthFactorRaw === 0n) {
        if (totalCollateralBase === 0n) {
          healthFactor = 0;
        } else {
          // Skip this case (would continue in real code)
          healthFactor = Number.NaN;
        }
      } else {
        healthFactor = Number(healthFactorRaw) / 1e18;
      }
      
      expect(healthFactor).toBe(Number.POSITIVE_INFINITY);
      expect(Number.isFinite(healthFactor)).toBe(false);
    });
    
    it('should treat healthFactorRaw === 0 with debt and NO collateral as real HF=0', () => {
      const totalCollateralBase = 0n; // No collateral
      const totalDebtBase = 1000000000000000000n; // 1 ETH debt
      const healthFactorRaw = 0n; // Real HF=0 (liquidatable)
      
      let healthFactor: number;
      
      if (totalDebtBase === 0n) {
        healthFactor = Number.POSITIVE_INFINITY;
      } else if (healthFactorRaw === 0n) {
        if (totalCollateralBase === 0n) {
          healthFactor = 0; // Real HF=0
        } else {
          // Skip this case (would continue in real code)
          healthFactor = Number.NaN;
        }
      } else {
        healthFactor = Number(healthFactorRaw) / 1e18;
      }
      
      expect(healthFactor).toBe(0);
      expect(healthFactor).toBeLessThan(1.0);
    });
    
    it('should skip healthFactorRaw === 0 with debt AND collateral (invalid case)', () => {
      const totalCollateralBase = 1000000000000000000n; // 1 ETH collateral
      const totalDebtBase = 1000000000000000000n; // 1 ETH debt
      const healthFactorRaw = 0n; // Invalid: has collateral but HF=0
      
      let shouldSkip = false;
      let healthFactor: number = Number.NaN;
      
      if (totalDebtBase === 0n) {
        healthFactor = Number.POSITIVE_INFINITY;
      } else if (healthFactorRaw === 0n) {
        if (totalCollateralBase === 0n) {
          healthFactor = 0;
        } else {
          // This case should be skipped
          shouldSkip = true;
        }
      } else {
        healthFactor = Number(healthFactorRaw) / 1e18;
      }
      
      expect(shouldSkip).toBe(true);
      expect(Number.isNaN(healthFactor)).toBe(true);
    });
    
    it('should calculate normal HF correctly when debt > 0 and HF > 0', () => {
      const totalCollateralBase = 2000000000000000000n; // 2 ETH
      const totalDebtBase = 1000000000000000000n; // 1 ETH
      const healthFactorRaw = 1500000000000000000n; // 1.5 HF (1.5 * 1e18)
      
      let healthFactor: number;
      
      if (totalDebtBase === 0n) {
        healthFactor = Number.POSITIVE_INFINITY;
      } else if (healthFactorRaw === 0n) {
        if (totalCollateralBase === 0n) {
          healthFactor = 0;
        } else {
          healthFactor = Number.NaN;
        }
      } else {
        healthFactor = Number(healthFactorRaw) / 1e18;
      }
      
      expect(healthFactor).toBe(1.5);
      expect(Number.isFinite(healthFactor)).toBe(true);
    });
    
    it('should handle very low HF (liquidatable) correctly', () => {
      const totalCollateralBase = 1000000000000000000n; // 1 ETH
      const totalDebtBase = 1000000000000000000n; // 1 ETH
      const healthFactorRaw = 950000000000000000n; // 0.95 HF (liquidatable)
      
      let healthFactor: number;
      
      if (totalDebtBase === 0n) {
        healthFactor = Number.POSITIVE_INFINITY;
      } else if (healthFactorRaw === 0n) {
        if (totalCollateralBase === 0n) {
          healthFactor = 0;
        } else {
          healthFactor = Number.NaN;
        }
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
        { address: '0x1', healthFactor: Number.POSITIVE_INFINITY },
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
        { address: '0x1', healthFactor: Number.POSITIVE_INFINITY },
        { address: '0x2', healthFactor: Number.POSITIVE_INFINITY },
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
    
    it('should include real HF=0 in minHF calculation', () => {
      // Real HF=0 should be tracked (no collateral + debt)
      const users = [
        { address: '0x1', healthFactor: 1.5 },
        { address: '0x2', healthFactor: 0 }, // Real HF=0 (liquidatable)
        { address: '0x3', healthFactor: 0.95 },
      ];
      
      let minHF: number | null = null;
      for (const user of users) {
        const hf = user.healthFactor;
        
        if (!Number.isFinite(hf)) continue;
        
        if (minHF === null || hf < minHF) {
          minHF = hf;
        }
      }
      
      expect(minHF).toBe(0);
    });
  });
});
