/* global  artifacts:true, web3: true, contract: true */
import chai from 'chai'
import { soliditySha3 as sha3 } from 'web3-utils'
import { advanceNBlocks, expectRevert } from './helpers'
import Accounts from 'web3-eth-accounts'
import { ether } from './constants'

chai
.use(require('chai-bignumber')(web3.BigNumber))
.should()

const Exchange = artifacts.require('./Exchange.sol')
const Token = artifacts.require('./utils/Token.sol')

contract('Exchange', (accounts) => {
  let admin = accounts[0]
  let feeAccount = accounts[1]
  let trader1 = accounts[2]
  let trader2 = accounts[3]
  let privateKey1 = '0x2bdd21761a483f71054e14f5b827213567971c676928d9a1808cbfa4b7501202'
  let privateKey2 = '0x2bdd21761a483f71054e14f5b827213567971c676928d9a1808cbfa4b7501203'
  let exchange
  let token1
  let token2
  let amount

  beforeEach(async() => {
    exchange = await Exchange.new(feeAccount)
  })

  describe('Admin functions', async () => {
    it('should set the fee account', async () => {
      let expectedNewFeeAccount = accounts[3]
      await exchange.setFeeAccount(expectedNewFeeAccount)
      let newFeeAccount = await exchange.feeAccount.call()
      newFeeAccount.should.be.equal(expectedNewFeeAccount)
    })

    it('should set the admin account', async () => {
      let newAdmin = accounts[3]
      await exchange.setAdmin(newAdmin, true)

      let isAdmin = await exchange.admins.call(newAdmin)
      isAdmin.should.be.equal(true)

      await exchange.setAdmin(newAdmin, false)

      isAdmin = await exchange.admins.call(newAdmin)
      isAdmin.should.be.equal(false)
    })

    it('should set the withdrawal security period', async () => {
      await exchange.setWithdrawalSecurityPeriod(100000)
      let withdrawalSecurityPeriod = await exchange.withdrawalSecurityPeriod.call()
      withdrawalSecurityPeriod.should.be.bignumber.equal(100000)
    })
  })

  describe('Deposit', async () => {
    beforeEach(async () => {
      exchange = await Exchange.new(feeAccount)
      token1 = await Token.new(trader1, 1000)
      await token1.approve(exchange.address, 1000, { from: trader1 })
    })

    it('should be able to deposit tokens', async () => {
      await exchange.depositToken(token1.address, 1000, {from: trader1})
      let depositedTokens = await exchange.tokenBalance(trader1, token1.address)
      depositedTokens.should.be.bignumber.equal(1000)
    })

    it('should be able to deposit ether', async () => {
      await exchange.depositEther({from: trader1, value: 1 * 10 ** 18})
      let depositedEther = await exchange.etherBalance(trader1)
      depositedEther.should.be.bignumber.equal(1 * 10 ** 18)
    })
  })

  describe('Withdraw deposit', async () => {
    beforeEach(async () => {
      exchange = await Exchange.new(feeAccount)
      token1 = await Token.new(trader1, 1000)
      await exchange.setWithdrawalSecurityPeriod(10)

    })

    it('trader1 should be able to withdraw tokens after withdrawal period', async () => {
      await token1.approve(exchange.address, 1000, { from: trader1 })
      await exchange.depositToken(token1.address, 1000, {from: trader1 })

      await advanceNBlocks(10)
      await exchange.securityWithdraw(token1.address, 1000, { from: trader1 })
      let tokenBalance = await token1.balanceOf(trader1)
      tokenBalance.should.be.bignumber.equal(1000)

      let exchangeTokenBalance = await exchange.tokenBalance(trader1, token1.address)
      exchangeTokenBalance.should.be.bignumber.equal(0)
    })

    it('trader1 should be able to withdraw tokens after withdrawal period', async () => {
      await exchange.depositEther({ from: trader1, value: 1 * ether })
      let initialEtherBalance = await web3.eth.getBalance(trader1)
      await advanceNBlocks(10)
      await exchange.securityWithdraw(0x0, 10 ** 18, { from: trader1 })
      let etherBalance = await web3.eth.getBalance(trader1)
      let expectedEtherBalance = etherBalance.plus(1 * ether)
      etherBalance.should.be.bignumber.equal(expectedEtherBalance)

    })

    it('should not be able make a withdraw tokens/ether before the security period', async () => {
      await token1.approve(exchange.address, 1000, { from: trader1 })
      await exchange.depositToken(token1.address, 1000, { from: trader1 })

      await advanceNBlocks(5)
      await expectRevert(exchange.securityWithdraw(token1.address, 1000, { from: trader1 }))
    })

    it.only('operator with a signed message should be able to withdraw', async () => {
      await token1.approve(exchange.address, 1000, { from: trader1 })
      await exchange.depositToken(token1.address, 1000, { from: trader1 })

      let accounts = new Accounts('http://localhost:8545')
      let feeWithdrawal = 100
      let amount = 1000
      let nonce = 0
      let withdrawalHash = sha3(exchange.address, token1.address, amount, trader1, trader1, nonce)
      let { message, messageHash, r, s, v } = accounts.sign(withdrawalHash, privateKey1)
      await exchange.withdraw(token1.address, amount, trader1, trader1, nonce, v, [r, s], feeWithdrawal)
    })
  })

  describe('Trading', async () => {
    beforeEach(async () => {
      exchange = await Exchange.new(feeAccount)
      token1 = await Token.new(trader1, 1000)
      token2 = await Token.new(trader2, 500)

      await token1.approve(exchange.address, 1000, { from: trader1 })
      await exchange.depositToken(token1.address, 1000, { from: trader1 })

      await token2.approve(exchange.address, 500, { from: trader2 })
      await exchange.depositToken(token2.address, 500, { from: trader2 })

    })

    it.only('should execute a trade', async () => {
        let accounts = new Accounts('http://localhost:8545')

        let order = {
          amountBuy: 1000,
          amountSell: 1000,
          expires: 0,
          nonce: 0,
          feeMake: 10,
          feeTake: 10,
          tokenBuy: token2.address,
          tokenSell: token1.address,
          maker: trader1
        }

        let trade = {
          amount: 500,
          tradeNonce: 0,
          taker: trader2
        }

        let orderHash = sha3(
          exchange.address,
          order.tokenBuy,
          order.amountBuy,
          order.tokenSell,
          order.amountSell,
          order.expires,
          order.nonce,
          order.maker
        )

        let tradeHash = sha3(
          orderHash,
          trade.amount,
          trade.taker,
          trade.tradeNonce
        )

        let { message: message1, messageHash: messageHash1, r: r1, s: s1, v: v1 } = accounts.sign(orderHash, privateKey1)
        let { message: message2, messageHash: messageHash2, r: r2, s: s2, v: v2 } = accounts.sign(tradeHash, privateKey2)

        let orderValues = [
          order.amountBuy,
          order.amountSell,
          order.expires,
          order.nonce,
          order.feeMake,
          order.feeTake,
          trade.amount,
          trade.tradeNonce
        ]

        let orderAddresses = [
          order.tokenBuy,
          order.tokenSell,
          order.maker,
          trade.taker
        ]

        await exchange.executeTrade(
          orderValues,
          orderAddresses,
          [v1, v2],
          [r1, s1, r2, s2]
        )

        let trader1BalanceOfToken1 = await exchange.tokenBalance(trader1, token1.address)
        let trader1BalanceOfToken2 = await exchange.tokenBalance(trader1, token2.address)
        let trader2BalanceOfToken1 = await exchange.tokenBalance(trader2, token1.address)
        let trader2BalanceOfToken2 = await exchange.tokenBalance(trader2, token2.address)

        trader1BalanceOfToken1.should.be.bignumber.equal(500)
        trader1BalanceOfToken2.should.be.bignumber.equal(500)
        trader2BalanceOfToken1.should.be.bignumber.equal(500)
        trader2BalanceOfToken2.should.be.bignumber.equal(0)
    })
  })


})