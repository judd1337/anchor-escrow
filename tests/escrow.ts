import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Escrow } from "../target/types/escrow";
import { Authorized, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { BN } from "bn.js";
import { 
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID, 
  getAssociatedTokenAddressSync, 
  getMinimumBalanceForRentExemptMint, 
  createInitializeMint2Instruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import { log } from "console";

describe("escrow", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Escrow as Program<Escrow>;
  const maker = anchor.web3.Keypair.generate(); // Keypair for the maker
  const taker = anchor.web3.Keypair.generate(); // Keypair for the taker
  const mintA = anchor.web3.Keypair.generate(); // Keypair for the mint_a
  const mintB = anchor.web3.Keypair.generate(); // Keypair for the mint_b
  const seed = new anchor.BN(randomBytes(8)); // Seed for the escrow account
  const tokenProgram = TOKEN_PROGRAM_ID;
  
  const makerMintAAta = getAssociatedTokenAddressSync(mintA.publicKey, maker.publicKey, false, tokenProgram);
  const takerMintBAta = getAssociatedTokenAddressSync(mintB.publicKey, taker.publicKey, false, tokenProgram);
  
  const [escrow] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const vault = getAssociatedTokenAddressSync(mintA.publicKey, escrow, true, tokenProgram);

  it("airdrop", async () => {
    let lamports = await getMinimumBalanceForRentExemptMint(program.provider.connection);
    let tx = new anchor.web3.Transaction();
    tx.instructions = [
      SystemProgram.transfer({
        fromPubkey: program.provider.publicKey,
        toPubkey: maker.publicKey,
        lamports: 0.2 * LAMPORTS_PER_SOL,
      }),
      SystemProgram.transfer({
        fromPubkey: program.provider.publicKey,
        toPubkey: taker.publicKey,
        lamports: 0.2 * LAMPORTS_PER_SOL,
      }),
      SystemProgram.createAccount({
        fromPubkey: program.provider.publicKey,
        newAccountPubkey: mintA.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: tokenProgram,
      }),
      SystemProgram.createAccount({
        fromPubkey: program.provider.publicKey,
        newAccountPubkey: mintB.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: tokenProgram,
      }),
      ...[
        { mint: mintA.publicKey, authority: maker.publicKey, ata: makerMintAAta },
        { mint: mintB.publicKey, authority: taker.publicKey, ata: takerMintBAta },
      ]
      .flatMap((x) => [
        createInitializeMint2Instruction(x.mint, 6, x.authority, null, tokenProgram),
        createAssociatedTokenAccountIdempotentInstruction(provider.publicKey, x.ata, x.authority, x.mint, tokenProgram),
        createMintToInstruction(x.mint, x.ata, x.authority, 1e6, undefined, tokenProgram),  
      ])

      //createInitializeMint2Instruction(mintA.publicKey, 6, maker.publicKey, null, tokenProgram),
      //createAssociatedTokenAccountIdempotentInstruction(provider.publicKey, makerMintAAta, maker.publicKey, mintA.publicKey),
      //createMintToInstruction(mintA.publicKey, makerMintAAta, maker.publicKey, 1e9, undefined, tokenProgram),
      //createInitializeMint2Instruction(mintB.publicKey, 6, taker.publicKey, null, tokenProgram),
      //createAssociatedTokenAccountIdempotentInstruction(provider.publicKey, takerAtaB, taker.publicKey, mintA.publicKey),
      //createMintToInstruction(mintB.publicKey, takerAtaB, taker.publicKey, 1e9, undefined, tokenProgram),
    ];

    console.log({maker:maker.publicKey.toString(), taker:taker.publicKey.toString(), mintA:mintA.publicKey.toString(), mintB:mintB.publicKey.toString()});

    await provider.sendAndConfirm(tx, [maker, taker, mintA, mintB]).then(log);
  })

  it("Make - lets make an escrow!", async () => {
    const accounts = {
      maker: maker.publicKey,
      mintA: mintA.publicKey,
      mintB: mintB.publicKey,
      makerMintAAta,
      escrow,
      vault,
      //associated_token_program,
      tokenProgram,
      //system_program,
    }

    let depositAmount = new BN(100); // Maker's deposit amount
    let receiveAmount = new BN(1000); // Taker's expected token amount

    // Call the `make` instruction
    const tx = await program.methods
      .make(seed, receiveAmount, depositAmount)
      //.accountsPartial({})
      //.accountsStrict({})
      //.accounts({
      .accountsPartial({
        ...accounts
      })
      .signers([maker]) // Sign with the maker's keypair
      .rpc();

      // Verify the escrow state was initialized correctly
      const escrowAccount = await program.account.escrowState.fetch(escrow);
      assert.ok(escrowAccount.maker.equals(maker.publicKey));
      assert.ok(escrowAccount.receiveAmount.eq(receiveAmount));
      assert.ok(escrowAccount.seed.eq(seed));
      console.log("Escrow account initialized successfully:", escrowAccount);
      
  });

  it("Refund - lets refund from the escrow!", async () => {
    console.log("Before accounts even! ...");

    const accounts = {
      maker: maker.publicKey,
      mintA: mintA.publicKey,
      mintB: mintB.publicKey,
      makerMintAAta,
      escrow,
      vault,
      //associated_token_program,
      tokenProgram,
      //system_program,
    };

    // Fetch balances before refund
    const vaultBefore = await provider.connection.getTokenAccountBalance(vault);
    const makerBefore = await provider.connection.getTokenAccountBalance(makerMintAAta);

    console.log("Vault balance before refund:", vaultBefore.value.amount);
    console.log("Maker ATA balance before refund:", makerBefore.value.amount);

    // Call the refund instruction
    console.log("Invoking refund instruction...");
    const tx = await program.methods
      .refund()
      .accountsPartial({
        ...accounts
      })
      .signers([maker]) // Sign with the maker's keypair
      .rpc();
      
    console.log("Refund transaction signature:", tx);

    // Fetch balance after refund
    const makerAfter = await provider.connection.getTokenAccountBalance(makerMintAAta);
    console.log("Maker ATA balance after refund:", makerAfter.value.amount);
    
    // **ASSERTIONS**

    // 1. Ensure maker received the refunded tokens
    assert.strictEqual(
      parseInt(makerAfter.value.amount) - parseInt(makerBefore.value.amount),
      parseInt(vaultBefore.value.amount),
      "Maker should receive the exact amount refunded from the vault"
    );

    // 2. Ensure escrow account is closed
    try {
      await program.account.escrowState.fetch(escrow);
      assert.fail("Escrow account should be closed after refund");
    } catch (error) {
      assert.ok("Escrow account successfully closed after refund");
    }

    // 3. Ensure vault account is closed
    try {
      await program.account.escrowState.fetch(vault);
      assert.fail("Escrow account should be closed after refund");
    } catch (error) {
      assert.ok("Escrow account successfully closed after refund");
    }
  });

  it("Take - lets take from the escrow!", async () => {
    console.log("Before accounts even! ...");

    console.log("before setting up accounts for make");
    // 1. First run Make before we can run Take
    const make_accounts = {
      maker: maker.publicKey,
      mintA: mintA.publicKey,
      mintB: mintB.publicKey,
      makerMintAAta,
      escrow,
      vault,
      tokenProgram,
    }

    let depositAmount = new BN(100); // Maker's deposit amount
    let receiveAmount = new BN(1000); // Taker's expected token amount

    console.log("before calling make");
    // Call the `make` instruction
    const make_tx = await program.methods
      .make(seed, receiveAmount, depositAmount)
      .accountsPartial({
        ...make_accounts
      })
      .signers([maker]) // Sign with the maker's keypair
      .rpc();

    console.log("after calling make");
    // Fetch balances before refund
    const vaultBefore = await provider.connection.getTokenAccountBalance(vault);
    const takerBefore = await provider.connection.getTokenAccountBalance(takerMintBAta);

    console.log("Vault balance before take:", vaultBefore.value.amount);
    console.log("Taker ATA balance before take:", takerBefore.value.amount);

    // 2. Call the 'Take' instruction
    const accounts = {
      taker: taker.publicKey,
      maker: maker.publicKey,
      mintA: mintA.publicKey,
      mintB: mintB.publicKey,
      takerMintBAta,
      escrow,
      vault,
      tokenProgram,
    };

    // Call the take instruction
    console.log("Invoking take instruction...");
    try {
      const take_tx = await program.methods
      .take()
      .accountsPartial({
        ...accounts
      })
      .signers([taker]) // Sign with the taker's keypair
      .rpc();
      
      console.log("take transaction signature:", take_tx);
    }  catch(e) {
      console.log(e);
      throw(e)
    }
    

    // Fetch balance after take
    const takerMintAAta = getAssociatedTokenAddressSync(mintA.publicKey, taker.publicKey, false, tokenProgram);
    const takerAfter = await provider.connection.getTokenAccountBalance(takerMintAAta);
    console.log("Taker ATA balance after take:", takerAfter.value.amount);
    
    // **ASSERTIONS**

    // 1. Ensure taker received the taken tokens
    assert.strictEqual(
      parseInt(takerAfter.value.amount), parseInt(vaultBefore.value.amount),
      "Taker should receive the exact amount taken from the vault"
    );

    // 2. Ensure escrow account is closed
    try {
      await program.account.escrowState.fetch(escrow);
      assert.fail("Escrow account should be closed after take");
    } catch (error) {
      assert.ok("Escrow account successfully closed after take");
    }

    // 3. Ensure vault account is closed
    try {
      await program.account.escrowState.fetch(vault);
      assert.fail("Escrow account should be closed after refund");
    } catch (error) {
      assert.ok("Escrow account successfully closed after refund");
    }
  });


});


