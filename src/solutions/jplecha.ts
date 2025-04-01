import type {
  API,
  FinalizedEvent,
  IncomingEvent,
  NewBlockEvent,
  NewTransactionEvent,
  OutputAPI,
  Settled
} from "../types"

// Requirements:
//
// 1) When a transaction becomes "settled"-which always occurs upon receiving a "newBlock" event-
//    you must call `outputApi.onTxSettled`.
//
//    - Multiple transactions may settle in the same block, so `onTxSettled` could be called
//      multiple times per "newBlock" event.
//    - Ensure callbacks are invoked in the same order as the transactions originally arrived.
//
// 2) When a transaction becomes "done"-meaning the block it was settled in gets finalized-
//    you must call `outputApi.onTxDone`.
//
//    - Multiple transactions may complete upon a single "finalized" event.
//    - As above, maintain the original arrival order when invoking `onTxDone`.
//    - Keep in mind that the "finalized" event is not emitted for all finalized blocks.
//
// Notes:
// - It is **not** ok to make redundant calls to either `onTxSettled` or `onTxDone`.
// - It is ok to make redundant calls to `getBody`, `isTxValid` and `isTxSuccessful`
//
// Bonus 1:
// - Avoid making redundant calls to `getBody`, `isTxValid` and `isTxSuccessful`.
//
// Bonus 2:
// - Upon receiving a "finalized" event, call `api.unpin` to unpin blocks that are either:
//     a) pruned, or
//     b) older than the currently finalized block.
export default function jplecha(api: API, outputApi: OutputAPI) {
  const pendingTxs: string[] = []

  const pendingTxsSet: Set<string> = new Set()

  const settledTxsMap: Map<string, string> = new Map()

  const doneTxsSet: Set<string> = new Set()

  const blockTxsMap: Map<string, string[]> = new Map()

  const onNewBlock = ({ blockHash, parent }: NewBlockEvent) => {
    const txsInBlock = api.getBody(blockHash)
    blockTxsMap.set(blockHash, [])

    const remainingPending: string[] = []

    for (const txHash of pendingTxs) {
      if (txsInBlock.includes(txHash) && api.isTxValid(blockHash, txHash)) {

        if (!settledTxsMap.has(txHash)) {
          settledTxsMap.set(txHash, blockHash)

          var settled: Settled = {
            blockHash: blockHash,
            type: "invalid"
          }

          outputApi.onTxSettled(txHash, settled);
        }



        blockTxsMap.get(blockHash)!.push(txHash)
        pendingTxsSet.delete(txHash)
      } else {
        remainingPending.push(txHash)
      }
    }

    pendingTxs.length = 0

    pendingTxs.push(...remainingPending)
  }


  const onNewTx = ({ value: transaction }: NewTransactionEvent) => {
    if (!pendingTxsSet.has(transaction)) {
      pendingTxs.push(transaction)
      pendingTxsSet.add(transaction)

    }
  }

  const onFinalized = ({ blockHash }: FinalizedEvent) => {
    const txsInBlock = blockTxsMap.get(blockHash) || []

    for (const txHash of txsInBlock) {
      if (!doneTxsSet.has(txHash)) {
        doneTxsSet.add(txHash)

        const successful = api.isTxSuccessful(blockHash, txHash)

        const settledInfo: Settled = {
          blockHash,
          type: "valid",
          successful,
        }

        outputApi.onTxDone(txHash, settledInfo)
      }
    }
  }

  return (event: IncomingEvent) => {
    switch (event.type) {
      case "newBlock": {
        onNewBlock(event)
        break
      }
      case "newTransaction": {
        onNewTx(event)
        break
      }
      case "finalized":
        onFinalized(event)
    }
  }
}
