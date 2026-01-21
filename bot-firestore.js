const { Client, GatewayIntentBits, Events } = require('discord.js');
const admin = require('firebase-admin');
require('dotenv').config();

// Inicializace Firebase Admin SDK
// Pokud máte serviceAccountKey.json, použijte:
// const serviceAccount = require('./serviceAccountKey.json');
// admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount),
//     projectId: 'poznamky-test'
// });

// Inicializace Firebase Admin SDK
// Podporuje:
// 1. Service Account Key z environment variable (pro cloud - doporučeno)
// 2. Service Account Key z souboru (pro lokální vývoj)
// 3. Application Default Credentials (fallback)
try {
    let serviceAccount;
    
    // Zkusit načíst z environment variable (pro cloud)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log('✅ Načten Service Account z environment variable');
    } 
    // Zkusit načíst ze souboru (pro lokální vývoj)
    else {
        try {
            serviceAccount = require('./serviceAccountKey.json');
            console.log('✅ Načten Service Account ze souboru');
        } catch (fileError) {
            throw new Error('Service Account Key nenalezen');
        }
    }
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'poznamky-test'
    });
    console.log('✅ Firebase inicializován pomocí service account');
} catch (error) {
    // Fallback na Application Default Credentials
    try {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId: 'poznamky-test'
        });
        console.log('✅ Firebase inicializován pomocí Application Default Credentials');
    } catch (fallbackError) {
        console.error('❌ Chyba při inicializaci Firebase:', fallbackError.message);
        console.error('Ujistěte se, že máte nastavený FIREBASE_SERVICE_ACCOUNT nebo serviceAccountKey.json');
        process.exit(1);
    }
}

const db = admin.firestore();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Funkce pro uložení dat do Firestore
async function saveToFirestore(eventType, data) {
    try {
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        
        // Uložit událost
        await db.collection('discordEvents').add({
            eventType,
            data,
            timestamp,
            createdAt: timestamp
        });

        // Aktualizovat statistiky
        const statsRef = db.collection('discordStats').doc('current');
        const statsDoc = await statsRef.get();
        const currentStats = statsDoc.exists ? statsDoc.data() : {
            totalMessages: 0,
            totalMembersJoined: 0,
            totalMembersLeft: 0
        };

        switch (eventType) {
            case 'bot_ready':
                await statsRef.set({
                    ...currentStats,
                    botStatus: {
                        ...data,
                        lastUpdate: new Date().toISOString()
                    }
                }, { merge: true });
                break;

            case 'message':
                await statsRef.set({
                    ...currentStats,
                    totalMessages: (currentStats.totalMessages || 0) + 1
                }, { merge: true });
                break;

            case 'member_join':
                await statsRef.set({
                    ...currentStats,
                    totalMembersJoined: (currentStats.totalMembersJoined || 0) + 1
                }, { merge: true });
                break;

            case 'member_leave':
                await statsRef.set({
                    ...currentStats,
                    totalMembersLeft: (currentStats.totalMembersLeft || 0) + 1
                }, { merge: true });
                break;
        }

        console.log(`✅ Data uložena do Firestore: ${eventType}`);
    } catch (error) {
        console.error(`❌ Chyba při ukládání do Firestore: ${error.message}`);
    }
}

// Když se bot připojí
client.once(Events.ClientReady, async () => {
    console.log(`✅ Bot je připojen jako ${client.user.tag}!`);
    
    // Uložit informace o připojení
    await saveToFirestore('bot_ready', {
        botName: client.user.tag,
        botId: client.user.id,
        guildCount: client.guilds.cache.size,
        userCount: client.users.cache.size
    });
});

// Když přijde nová zpráva
client.on(Events.MessageCreate, async (message) => {
    // Ignorovat zprávy od botů
    if (message.author.bot) return;

    await saveToFirestore('message', {
        messageId: message.id,
        content: message.content,
        author: {
            id: message.author.id,
            username: message.author.username,
            discriminator: message.author.discriminator,
            avatar: message.author.displayAvatarURL()
        },
        channel: {
            id: message.channel.id,
            name: message.channel.name
        },
        guild: {
            id: message.guild?.id,
            name: message.guild?.name
        }
    });
});

// Když se uživatel připojí na server
client.on(Events.GuildMemberAdd, async (member) => {
    await saveToFirestore('member_join', {
        userId: member.user.id,
        username: member.user.username,
        guildId: member.guild.id,
        guildName: member.guild.name,
        memberCount: member.guild.memberCount
    });
});

// Když uživatel opustí server
client.on(Events.GuildMemberRemove, async (member) => {
    await saveToFirestore('member_leave', {
        userId: member.user.id,
        username: member.user.username,
        guildId: member.guild.id,
        guildName: member.guild.name,
        memberCount: member.guild.memberCount
    });
});

// Připojit bota
client.login(process.env.DISCORD_TOKEN);

