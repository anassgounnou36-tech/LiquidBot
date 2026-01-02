// realtime/aavePoolListeners.ts: Subscribe to Aave Pool events
// Mark impacted users dirty when borrow/repay/supply/withdraw events occur

import { Interface, Log, WebSocketProvider } from 'ethers';

// Aave V3 Pool event ABIs (minimal: user-impacting events only)
const AAVE_POOL_ABI = [
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint256 borrowRateMode, uint256 borrowRate, uint16 indexed referralCode)',
  'event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)',
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
  'event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)'
];

type UserCallback = (user: string) => void;

/**
 * Start listening to Aave Pool events and mark impacted users dirty
 * 
 * @param ws WebSocket provider for event subscriptions
 * @param poolAddress Aave V3 Pool contract address
 * @param onUser Callback when user is impacted by an event
 */
export function startAavePoolListeners(
  ws: WebSocketProvider,
  poolAddress: string,
  onUser: UserCallback
): void {
  const iface = new Interface(AAVE_POOL_ABI);
  
  console.log(`[aave-pool-listeners] Starting listeners on ${poolAddress}`);

  // Subscribe to each event type
  for (const eventName of ['Borrow', 'Repay', 'Supply', 'Withdraw'] as const) {
    const event = iface.getEvent(eventName);
    if (!event) {
      console.warn(`[aave-pool-listeners] Event ${eventName} not found in ABI`);
      continue;
    }

    const topic = event.topicHash;
    const filter = {
      address: poolAddress,
      topics: [topic]
    };

    ws.on(filter, (log: Log) => {
      try {
        const parsed = iface.parseLog({
          topics: log.topics as string[],
          data: log.data
        });

        if (!parsed) return;

        // Extract user address from event args
        // All our events have a 'user' field
        const user = String(parsed.args.user);
        
        // Mark user dirty
        onUser(user);

        console.log(
          `[aave-pool-listeners] ${eventName}: user=${user} block=${log.blockNumber}`
        );
      } catch (err) {
        console.error(`[aave-pool-listeners] Error parsing ${eventName}:`, err);
      }
    });

    console.log(`[aave-pool-listeners] Subscribed to ${eventName}`);
  }
}
