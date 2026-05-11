/* ══════════════════════════════════════════════════
   VELOX WEB3 & DATABASE ENGINE
   ══════════════════════════════════════════════════ */

// ── Supabase Client Initialization ──
const supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// ── TON Connect Initialization ──
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://spin-and-win-axol.onrender.com/tonconnect-manifest.json',
    buttonRootId: 'ton-connect-button'
});

const WEB3 = {
    user: null,
    isRealMode: false,

    async init() {
        const tg = window.Telegram.WebApp;
        tg.expand();
        tg.ready();

        const tgUser = tg.initDataUnsafe?.user;
        if (tgUser) {
            this.user = await this.getOrCreateUser(tgUser);
            console.log("Logged in as:", this.user.username);
        }

        this.setupListeners();
    },

    async getOrCreateUser(tgUser) {
        let { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', tgUser.id)
            .single();

        if (!user) {
            const { data, error: insertError } = await supabase
                .from('users')
                .insert([
                    { 
                        id: tgUser.id, 
                        username: tgUser.username, 
                        first_name: tgUser.first_name,
                        balance: 0,
                        demo_balance: 5000
                    }
                ])
                .select()
                .single();
            user = data;
        }
        return user;
    },

    async updateBalance(amount, isReal) {
        const field = isReal ? 'balance' : 'demo_balance';
        const newBalance = parseFloat(this.user[field]) + amount;

        const { data, error } = await supabase
            .from('users')
            .update({ [field]: newBalance })
            .eq('id', this.user.id)
            .select()
            .single();

        if (data) {
            this.user = data;
            return true;
        }
        return false;
    },

    async deposit(amount) {
        if (!tonConnectUI.connected) {
            alert("Please connect your wallet first!");
            return;
        }

        const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 60, // 60 seconds
            messages: [
                {
                    address: CONFIG.TREASURY_ADDRESS,
                    amount: (amount * 1000000000).toString(), // Convert to nanoTON
                }
            ]
        };

        try {
            const result = await tonConnectUI.sendTransaction(transaction);
            if (result) {
                // Log pending transaction
                await supabase.from('transactions').insert([
                    { 
                        user_id: this.user.id, 
                        type: 'deposit', 
                        amount: amount, 
                        tx_hash: result.boc, 
                        status: 'completed' // In a real app, we'd verify this on-chain first
                    }
                ]);
                
                await this.updateBalance(amount, true);
                return true;
            }
        } catch (e) {
            console.error("Transaction failed", e);
            return false;
        }
    },

    async requestWithdrawal(amount, address) {
        if (this.user.balance < amount) return { success: false, msg: "Insufficient balance" };

        const { error } = await supabase.from('transactions').insert([
            { 
                user_id: this.user.id, 
                type: 'withdraw', 
                amount: amount, 
                wallet_address: address,
                status: 'pending' 
            }
        ]);

        if (!error) {
            await this.updateBalance(-amount, true);
            return { success: true, msg: "Request submitted" };
        }
        return { success: false, msg: "Request failed" };
    },

    setupListeners() {
        // Real-time balance updates
        supabase
            .channel('public:users')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${this.user.id}` }, payload => {
                this.user = payload.new;
                if (window.updateUI) window.updateUI();
            })
            .subscribe();
    }
};
