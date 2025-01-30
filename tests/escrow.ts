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
        createMintToInstruction(x.mint, x.ata, x.authority, 1e9, undefined, tokenProgram),  
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

    console.log("Invoking refund instruction...");

    // Call the `make` instruction
    const tx = await program.methods
      .refund()
      .accountsPartial({
        ...accounts
      })
      .signers([maker]) // Sign with the maker's keypair
      .rpc();
      
  });
});


