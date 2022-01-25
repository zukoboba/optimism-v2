/* Imports: External */
import { Contract, ethers, Wallet, BigNumber, providers, utils } from 'ethers'
import express from 'express'

/* Imports: Internal */
import { fromHexString, sleep } from '@eth-optimism/core-utils'
import { BaseService } from '@eth-optimism/common-ts'

import { loadContract, loadContractFromManager } from '@eth-optimism/contracts'
import { VerifiedBlock } from './types'

interface FraudDetectorOptions {
  // Providers for interacting with L1 and L2.
  l1RpcProvider: providers.StaticJsonRpcProvider
  l2RpcProvider: providers.StaticJsonRpcProvider
  l2VerifierRpcProvider: providers.StaticJsonRpcProvider

  // Address of the AddressManager contract, used to resolve the various addresses we'll need
  // within this service.
  addressManagerAddress: string

  l1DeploymentBlock: number

  l2StartBlock: number

  l2CheckInterval: number

  l1ConfirmationBlock: number

  batchSize: number

  port: number
}

const optionSettings = {}

export class FraudDetectorService extends BaseService<FraudDetectorOptions> {
  constructor(options: FraudDetectorOptions) {
    super('Fraud_Detector', options, optionSettings)
  }

  private state: {
    verifiedBlock: VerifiedBlock
    app: any
    Lib_AddressManager: Contract
    StateCommitmentChain: Contract
    l1FromBlock: number
    l1ToBlock: number
    lastVerifiedL2Block: number
    StateRootCount: number
    errorBlock: boolean
  }

  protected async _init(): Promise<void> {
    this.logger.info('Initializing fraud detector', {
      addressManagerAddress: this.options.addressManagerAddress,
      l1DeploymentBlock: this.options.l1DeploymentBlock,
      l2StartBlock: this.options.l2StartBlock,
      l2CheckInterval: this.options.l2CheckInterval,
      l1ConfirmationBlock: this.options.l1ConfirmationBlock,
      batchSize: this.options.batchSize,
      port: this.options.port,
    })

    this.state = {} as any

    this.state.Lib_AddressManager = loadContract(
      'Lib_AddressManager',
      this.options.addressManagerAddress,
      this.options.l1RpcProvider
    )

    this.logger.info('Connecting to StateCommitmentChain...')
    this.state.StateCommitmentChain = await loadContractFromManager({
      name: 'StateCommitmentChain',
      Lib_AddressManager: this.state.Lib_AddressManager,
      provider: this.options.l1RpcProvider,
    })
    this.logger.info('Connected to StateCommitmentChain', {
      address: this.state.StateCommitmentChain.address,
    })

    this.state.l1FromBlock = this.options.l1DeploymentBlock
    this.state.lastVerifiedL2Block = this.options.l2StartBlock - 1
    this.state.StateRootCount = 0
    this.state.errorBlock = false
  }

  protected async _start(): Promise<void> {
    // Start express route
    this._startRoute()

    while (this.running && !this.state.errorBlock) {
      const l1BlockNumber =
        (await this.options.l1RpcProvider.getBlockNumber()) -
        this.options.l1ConfirmationBlock

      this.state.l1ToBlock = Math.min(
        l1BlockNumber,
        this.state.l1FromBlock + this.options.batchSize
      )

      // query SCC event
      const events = await this.state.StateCommitmentChain.queryFilter(
        this.state.StateCommitmentChain.filters.StateBatchAppended(),
        this.state.l1FromBlock,
        this.state.l1ToBlock
      )

      if (events.length && !this.state.errorBlock) {
        for (const event of events) {
          const hash = event.transactionHash
          const tx = await this.options.l1RpcProvider.getTransaction(hash)
          const payload = this.state.StateCommitmentChain.interface.parseTransaction({data: tx.data})
          const stateRoots = payload.args._batch
          const nextStatRootBlock = this.state.StateRootCount + stateRoots.length

          // Verifying the state roots
          if (
            nextStatRootBlock > this.state.lastVerifiedL2Block &&
            !this.state.errorBlock
          ) {
            let l2BlockNumber = this.state.lastVerifiedL2Block + 1

            this.logger.info(`L1-Block SCC-STATEROOT L2-STATEROOT VERIFIER-STATEROOT MISMATCH`)

            console.log({
              stateRoots,
              l2BlockNumber,
              total: this.state.lastVerifiedL2Block - 1,
              StateRootCount: this.state.StateRootCount
            })
            while (
              l2BlockNumber <= nextStatRootBlock &&
              !this.state.errorBlock
            ) {
              const l2BlockReceipt = await this.options.l2RpcProvider.send(
                'eth_getBlockByNumber',
                [utils.hexValue(l2BlockNumber), true]
              )
              const l2VerifierBlockReceipt =
                await this.options.l2VerifierRpcProvider.send(
                  'eth_getBlockByNumber',
                  [utils.hexValue(l2BlockNumber), true]
                )

              const l2StateRoot = l2BlockReceipt.stateRoot
              const l2VerifierStateRoot = l2VerifierBlockReceipt.stateRoot
              const SCCStateRoot = stateRoots[l2BlockNumber - this.state.lastVerifiedL2Block - 1]

              // Three cases
              let errorMessage = '**** MATCH ****'
              if (l2StateRoot !== l2VerifierStateRoot) {
                errorMessage = `**** SCC/L2 MISMATCH ****`
                this.state.errorBlock = true
              }
              if (l2StateRoot !== SCCStateRoot) {
                errorMessage = `**** L2/VERIFIER MISMATCH ****`
                this.state.errorBlock = true
              }
              if (l2VerifierStateRoot !== SCCStateRoot) {
                errorMessage = `**** SCC/VERIFIER MISMATCH ****`
                this.state.errorBlock = true
              }

              this.logger.info(`${l2BlockNumber} ${SCCStateRoot} ${l2StateRoot} ${l2VerifierStateRoot} ${errorMessage}`)
              l2BlockNumber += 1
              this.state.StateRootCount += 1
            }
            this.state.lastVerifiedL2Block = l2BlockNumber - 1

            if (this.state.errorBlock) {
              break
            }
          // Skip the blocks
          } else if (nextStatRootBlock <= this.state.lastVerifiedL2Block) {
            this.state.StateRootCount += stateRoots.length
            this.logger.info(`Skipping l2 block from ${this.state.StateRootCount - stateRoots.length} to ${this.state.StateRootCount}`)
          }
        }
      }

      this.state.l1FromBlock = this.state.l1ToBlock

      if (l1BlockNumber < this.state.l1FromBlock + this.options.batchSize) {
        await sleep(this.options.l2CheckInterval)
      }
    }
  }

  protected _startRoute() {
    this.state.app = express()

    this.state.app.post('/', (_req, res) => {
      res.end(JSON.stringify(this.state.verifiedBlock))
    })

    this.state.app.get('/', (_req, res) => {
      res.end(JSON.stringify(this.state.verifiedBlock))
    })

    this.state.app.listen(this.options.port)
  }
}
