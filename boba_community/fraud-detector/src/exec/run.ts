import { Wallet, providers } from 'ethers'
import { FraudDetectorService } from '../service'
import * as dotenv from 'dotenv'
import Config from 'bcfg'

dotenv.config()

const main = async () => {
  const env = process.env
  const config = new Config('fraud-detector')
  config.load({
    env: true,
    argv: true,
  })

  const L2_NODE_WEB3_URL = config.str('l2-node-web3-url', env.L2_NODE_WEB3_URL)
  const L1_NODE_WEB3_URL = config.str('l1-node-web3-url', env.L1_NODE_WEB3_URL)
  const L2_VERIFIER_NODE_WEB3_URL = config.str(
    'l2-verifier-node-web3-url',
    env.L2_VERIFIER_NODE_WEB3_URL
  )

  const ADDRESS_MANAGER_ADDRESS = config.str(
    'address-manager-address',
    env.ADDRESS_MANAGER_ADDRESS
  )

  const L1_DEPLOYMENT_BLOCK = config.uint(
    'l1-deployment-block',
    parseInt(env.L1_DEPLOYMENT_BLOCK, 10)
  )
  const L2_START_BLOCK = config.uint(
    'l2-start-block',
    parseInt(env.L2_START_BLOCK, 10) || 1
  )
  const L2_CHECK_INTERVAL = config.uint(
    'l2-check-interval',
    parseInt(env.L2_CHECK_INTERVAL, 10) || 60000 // 1 min
  )
  const L1_CONFIRMATIONS = config.uint(
    'l1-confirmation',
    parseInt(env.L1_CONFIRMATIONS, 10) || 8 // eight blocks
  )
  const BATCH_SIZE = config.uint(
    'batch-size',
    parseInt(env.BATCH_SIZE, 10) || 1000
  )

  const PORT = config.uint('port', parseInt(env.PORT, 10) || 8555)

  if (!ADDRESS_MANAGER_ADDRESS) {
    throw new Error('Must pass ADDRESS_MANAGER_ADDRESS')
  }
  if (!L1_NODE_WEB3_URL) {
    throw new Error('Must pass L1_NODE_WEB3_URL')
  }
  if (!L2_NODE_WEB3_URL) {
    throw new Error('Must pass L2_NODE_WEB3_URL')
  }
  if (!L2_VERIFIER_NODE_WEB3_URL) {
    throw new Error('Must pass L2_VERIFIER_NODE_WEB3_URL')
  }
  if (!L1_DEPLOYMENT_BLOCK) {
    throw new Error('Must pass L1_DEPLOYMENT_BLOCK')
  }

  const l2Provider = new providers.StaticJsonRpcProvider(L2_NODE_WEB3_URL)
  const l1Provider = new providers.StaticJsonRpcProvider(L1_NODE_WEB3_URL)
  const l2VerifierProvider = new providers.StaticJsonRpcProvider(
    L2_VERIFIER_NODE_WEB3_URL
  )

  const service = new FraudDetectorService({
    l1RpcProvider: l1Provider,
    l2RpcProvider: l2Provider,
    l2VerifierRpcProvider: l2VerifierProvider,
    addressManagerAddress: ADDRESS_MANAGER_ADDRESS,
    l1DeploymentBlock: L1_DEPLOYMENT_BLOCK,
    l2StartBlock: L2_START_BLOCK,
    l2CheckInterval: L2_CHECK_INTERVAL,
    l1ConfirmationBlock: L1_CONFIRMATIONS,
    batchSize: BATCH_SIZE,
    port: PORT,
  })

  await service.start()
}
export default main
