const xrpl = require('xrpl');

async function runTest() {
  console.log('================================');
  console.log('  CAM Logic — XRPL Anchoring Test');
  console.log('================================\n');

  const client = new xrpl.Client('wss://s.altnet.rippletest.net:51233');
  
  try {
    console.log('Connecting to XRPL testnet...');
    await client.connect();

    // Generate fresh wallet every time
    console.log('Creating fresh testnet wallet...');
    const { wallet } = await client.fundWallet();
    const { wallet: wallet2 } = await client.fundWallet();

    const reconciliationData = {
      app: 'CAMLogic',
      property: 'Test Property',
      timestamp: Date.now(),
      hash: '8F0A37B8109BF7CDCFE427ABA8547BFE'
    };

    const memo = Buffer.from(
      JSON.stringify(reconciliationData)
    ).toString('hex');

    const tx = {
      TransactionType: 'Payment',
      Account: wallet.address,
      Destination: wallet2.address,
      Amount: '1000',
      Memos: [{ Memo: { MemoData: memo } }]
    };

    console.log('Submitting to XRPL testnet...');
    const result = await client.submitAndWait(tx, { wallet });
    
    console.log('\n✅ SUCCESS!\n');
    console.log('TX Hash:', result.result.hash);
    console.log('\n🔗 Explorer Link:');
    console.log('https://testnet.xrpl.org/transactions/' 
      + result.result.hash);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.disconnect();
  }
}

runTest();
