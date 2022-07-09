# Elara Services: Tickets

This is a customizable ticket system that uses interactions and discord.js


# Getting Started
```js
const { Client } = require("discord.js"),
        Tickets = require(`@elara-services/tickets`),
        client = new Client({ intents: [ "GUILDS" ] }),
        tickets = new Tickets({
            client,
            prefix: "support", // This is what is used for interactions (buttons) and the start of the channel name
            webhookId: "WEBHOOK ID HERE",
            webhookToken: "WEBHOOK TOKEN HERE",
            encryptToken: "ASB!@#$%^&*(B", // This is to encrypt/decrypt the user IDs in the channel topic, to avoid non-staff from seeing who's ticket it is
            supportRoleIds: [
                "12345678", // Add the support role ids here
            ],
            supportUserIds: [
                `12345678`, // Add the support user ids here
            ],
            webhookUsername: "WEBHOOK USERNAME HERE",
            webhookAvatar: "WEBHOOK AVATAR URL HERE",
            ticketOpen: {
                content: "", // The content of the ticket message once it gets created, use "%user%" or "%server%" for the user mention or server name
                embeds: [], // View https://discord.com/developers/docs/resources/channel#embed-object 
            },
            appeals: { // OPTIONAL
                enabled: true, // If the appeals server checks should be enabled.
                mainserver: {
                    id: "", // The main server's id 
                    checkIfBanned: true // Check if the user is banned in the main server, if not they can't open a ticket.
                },
                embeds: {
                    not_banned: {} // The embeds, content and components for the not banned message. 
                }
            }
        })

    client.on("interactionCreate", (int) => tickets.run(int))

    client.on("ready", () => {
        console.log(`Client is ready`);
        // Use it as "node bot.js --starter" or just create a command in your bot to manage the starter message
        if (process.argv.find(c => c === "--starter")) {
            return tickets.starterMessage(`HELP OR SUPPORT CHANNEL ID HERE`, {
                embeds: [
                    { title: "Support Tickets", description: `Click the button below to create a support ticket!`, color: 0xFF000 }
                ]
            })
        }
    });

    client.login("BOT TOKEN HERE")
```