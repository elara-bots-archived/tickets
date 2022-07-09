const { Collection, WebhookClient } = require("discord.js"),
      { encrypt, decrypt } = require("aes256"),
      { generate } = require("shortid"),
        Webhook = require("discord-hook");

module.exports = class Tickets {
    constructor(options) {
        this.options = options;
    };
    get prefix() { return `system:ticket:${this.options.prefix}`; };
    webhook() {
        return new Webhook(`https://discord.com/api/webhooks/${this.options.webhookId}/${this.options.webhookToken}`, {
            username: this.options.webhookUsername || "Tickets", 
            avatar_url: this.options.webhookAvatar || "https://cdn.discordapp.com/emojis/818757771310792704.png?v=1", 
        }); 
    };

    async fetchMessages(channel, limit = 50, before, after, around) {
        if (limit && limit > 100) {
            let logs = [];
            const get = async (_before, _after) => {
                const messages = [ ...(await channel.messages.fetch({ limit: 100, before: _before || undefined, after: _after || undefined }).catch(() => new Collection())).values() ];
                if (limit <= messages.length) {
                    return (_after ? messages.slice(messages.length - limit, messages.length).map((message) => message).concat(logs) : logs.concat(messages.slice(0, limit).map((message) => message)));
                }
                limit -= messages.length;
                logs = (_after ? messages.map((message) => message).concat(logs) : logs.concat(messages.map((message) => message)));
                if (messages.length < 100) return logs;
                return get((_before || !_after) && messages[messages.length - 1].id, _after && messages[0].id);
            };
            return get(before, after);
        }
        return [ ...(await channel.messages.fetch({ limit, before, after, around }).catch(() => new Collection())).values() ];
    };

    displayMessages(channel, messages = [], ticketID, type) {
        let users = [];
        for (const i of messages.values()) {
            let f = users.find(c => c.user.id === i.author.id);
            if (f) f.count++; else users.push({ user: i.author, count: 1 });
        };
        return [`<discord-messages>`, `<discord-message author="${type} Ticket: ${ticketID}" bot="true" verified avatar="https://cdn.discordapp.com/emojis/847397714677334066.png?v=1" role-color="#1da1f2">Total Messages: ${users.map(c => c.count).reduce((a, b) => a + b, 0).toLocaleString()}<br>${users.map(c => `<discord-mention type="role" color="${channel.guild?.members?.cache?.get(c.user.id)?.displayColor ? channel.guild?.members?.cache?.get(c.user.id)?.displayHexColor : `#ffffff`}">${c.user.tag}</discord-mention> (${c.user.id})`).join("<br>")}</discord-message></discord-messages><discord-messages>`,
            ...messages.map(message => {
                let str = [
                    `<discord-message${message.author.bot ? ` bot="true"` : ""} timestamp="${message.createdAt.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} (PST/PDT) | ${message.createdAt.toLocaleString("en-GB", { timeZone: "Europe/London" })} (BST/British Time)" author="${message.author.username}" avatar=${message.author.displayAvatarURL({ dynamic: true, format: "png" })} role-color="${channel.guild?.members?.cache?.get(message.author.id)?.displayColor ? channel.guild?.members?.cache?.get(message.author.id)?.displayHexColor : `#ffffff`}">`
                ];
                if (message.content) {
                    let content = message.content;
                    if (message.mentions.users.size) for (const user of message.mentions.users.values()) content = content.replace(new RegExp(`<@!?${user.id}>`, "g"), `<discord-mention type="role" color="${message.guild?.members?.cache?.get?.(user?.id)?.displayHexColor ?? "#ffffff"}">${user.tag}</discord-mention>`);
                    if (message.mentions.channels.size) for (const channel of message.mentions.channels.values()) content = content.replace(new RegExp(channel.toString(), "g"), `<discord-mention type="channel">${channel.name}</discord-mention>`);
                    if (message.mentions.roles.size) for (const role of message.mentions.roles.values()) content = content.replace(new RegExp(role.toString(), "g"), `<discord-mention type="role" color="${role.hexColor}">${role.name}</discord-mention>`)
                    str.push(content)
                };
                if (message.attachments.size) str.push(message.attachments.map((c) => `<a href="${c.proxyURL}">${c.name}</a>`).join("<br>"))
                str.push(`<br><br><code style="background-color: #36393e; color: white;">ID: ${message.id}</code>`)
                return [...str, `</discord-message>`].join(" ");
            }),
            "</discord-messages>"].join(" ");
    };

    async closeTicket({ member, messages, channel, guild, user } = {}) {
        if (!this.options.webhookId || !this.options.webhookToken) return; 
        let embeds = [
            {
                author: { name: guild.name, icon_url: guild.iconURL({ dynamic: true }) },
                title: "Ticket: Closed",
                description: `▫️User: ${user.toString()} \`@${user.tag}\` (${user.id})\n▫️Closed By: ${member.toString()} (${member.id})\n▫️Channel: \`#${channel.name}\` (${channel.id})`,
                color: 0xFF0000,
                timestamp: new Date(),
                footer: { text: `Ticket ID: ${channel.name.split("-")[1]}` },
            }
        ];
        new WebhookClient({ id: this.options.webhookId, token: this.options.webhookToken })
            .send({ 
                username: this.options.webhookUsername || "Tickets", 
                avatarURL: this.options.webhookAvatar || "https://cdn.discordapp.com/emojis/818757771310792704.png?v=1", 
                embeds, 
                files: [ { name: "transcript.txt", attachment: Buffer.from(this.displayMessages(channel, messages.reverse(), channel.name.split("-")[1], this.options.prefix)) } ] 
            })
            .then(m => {
                let components = [{ type: 2, style: 5, label: "Transcript", emoji: { name: "📝" }, url: `https://my.elara.services/tickets?url=${Array.isArray(m.attachments) ? m.attachments?.[0]?.url : m.attachments instanceof Collection ? m.attachments?.first?.()?.url : "URL_NOT_FOUND" ?? "URL_NOT_FOUND"}` }];
                
                this.webhook()
                .embeds(embeds)
                .button({ type: 1, components })
                .edit(m.id)
                .catch(() => null);
                if (user) user.send({
                    embeds: [{
                        author: { name: guild.name, icon_url: guild.iconURL({ dynamic: true }) },
                        title: `Ticket: Closed`,
                        color: 0xFF0000,
                        timestamp: new Date(),
                        footer: { text: `Ticket ID: ${channel.name.split("-")[1]}` }
                    }],
                    components: [{ type: 1, components }]
                }).catch(() => null)
            })
            .catch((e) => console.log(e));
    };

    async run(int) {
        if (int?.isButton?.()) {
            let { guild, channel, member, customId } = int,
                  category = guild?.channels?.resolve?.(channel?.parentId),
                [ support, supportUsers ] = [ [], [] ];
            if (!guild || !guild.available || !channel || !member || !category) return;
            if (this.options?.supportRoleIds?.length) for (const sup of this.options.supportRoleIds) {
                let role = guild.roles.resolve(sup);
                if (role) support.push(sup);
            };

            if (this.options?.supportUserIds?.length) for (const uId of this.options.supportUserIds) {
                let member = guild.members.resolve(uId) || await guild.members.fetch(uId).catch((e) => {
                    if (e?.stack?.includes?.("Unknown Member")) this.options.supportUserIds = this.options.supportUserIds.filter(c => c !== uId);
                    return null;
                });
                if (member) supportUsers.push(uId);
            }
            /**
             * @param {import("discord.js").InteractionDeferReplyOptions|import("discord.js").InteractionReplyOptions} options 
             * @param {boolean} edit 
             * @param {boolean} defer 
             */
            const send = async (options = {}, defer = false) => {
                if (defer) return int.deferReply(options).catch(() => null);
                if (int.replied || int.deferred) return int.editReply(options).catch(() => null);
                return int.reply(options).catch(() => null);
            };
            switch (customId) {
                case this.prefix: {
                    await send({ ephemeral: true }, true);
                    if (this.options.appeals?.enabled) {
                        let appeals = this.options.appeals;
                        if (appeals.mainserver?.id && appeals.mainserver.checkIfBanned) {
                            let server = this.options.client.guilds.resolve(appeals.mainserver.id);
                            if (server?.available) {
                                let isBanned = await server.bans.fetch({ user: member.id, force: true }).catch(() => null);
                                if (!isBanned) return send(
                                    typeof appeals.embeds?.not_banned === "object" ? 
                                    appeals.embeds.not_banned : 
                                    { embeds: [
                                        { 
                                            author: { name: guild.name, icon_url: guild.iconURL({ dynamic: true }) },
                                            title: "INFO", 
                                            description: `❌ You can't open this ticket due to you not being banned in the main server!`, 
                                            color: 0xFF0000, 
                                            timestamp: new Date() 
                                        }
                                    ]}
                                )
                            }
                        }
                    }
                    let [ permissions, allow ] = [
                        [],
                        [ "ADD_REACTIONS", "ATTACH_FILES", "CREATE_INSTANT_INVITE", "EMBED_LINKS", "READ_MESSAGE_HISTORY", "VIEW_CHANNEL", "USE_EXTERNAL_EMOJIS", "SEND_MESSAGES" ]
                    ];
                    if (support.length) for (const sup of support) permissions.push({ type: "role", id: sup, allow });
                    if (supportUsers.length) for (const user of supportUsers) permissions.push({ type: "member", id: user, allow });
                    
                    /** @type {import("discord.js").TextChannel} */
                    let channel = await guild.channels.create(`${this.options.prefix}-${generate().slice(0, 5).replace(/-|_/g, "")}`, {
                        type: "GUILD_TEXT", parent: category, reason: `Ticket created by: @${member.user.tag} (${member.id})`,
                        topic: `ID: ${this.code(member.id, "e")}`,
                        permissionOverwrites: [
                            { type: "member", id: this.options.client.user.id, allow: ["ADD_REACTIONS", "ATTACH_FILES", "SEND_MESSAGES", "READ_MESSAGE_HISTORY", "EMBED_LINKS", "USE_EXTERNAL_EMOJIS", "VIEW_CHANNEL", "MENTION_EVERYONE"] },
                            { type: "member", id: member.id, allow: ["ADD_REACTIONS", "ATTACH_FILES", "SEND_MESSAGES", "READ_MESSAGE_HISTORY", "EMBED_LINKS", "USE_EXTERNAL_EMOJIS", "VIEW_CHANNEL"], deny: ["MENTION_EVERYONE"] },
                            { type: "role", id: guild.id, deny: ["VIEW_CHANNEL"] },
                            ...permissions
                        ]
                    }).catch((err) => { console.log(err); return null; });
                    if (!channel) return send({ content: `${emojis.x} I was unable to create the ticket channel, if this keeps happening contact one of the staff members via their DMs!` });
                    let msg = await channel.send({
                        content: this.options.ticketOpen?.content?.replace?.(/%user%/gi, member.user.toString())?.replace?.(/%server%/gi, guild.name) || `${member.user.toString()} 👋 Hello, please explain what you need help with.`,
                        embeds: this.options.ticketOpen?.embeds || [{
                            author: { name: guild.name, icon_url: guild.iconURL({ dynamic: true }) },
                            title: `Support will be with you shortly`,
                            color: 0xF50DE3,
                            timestamp: new Date(),
                            footer: { text: `To close this ticket press the button below.` }
                        }],
                        components: [{ type: 1, components: [{ type: 2, custom_id: `${this.prefix}:close`, label: "Close Ticket", style: 4, emoji: { name: "🔒" } }] }]
                    }).catch(() => null);
                    if (!msg) return null
                    if (this.options.webhookId && this.options.webhookToken) this.webhook()
                    .embed({
                        author: { name: guild.name, icon_url: guild.iconURL({ dynamic: true }) },
                        title: "Ticket: Opened",
                        description: `▫️User: ${member.user.toString()} \`@${member.user.tag}\` (${member.id})\n▫️Channel: \`#${channel.name}\` (${channel.id})`,
                        color: 0xFF000,
                        timestamp: new Date(),
                        footer: { text: `Ticket ID: ${channel.name.split("-")[1]}` },
                    }).send().catch((e) => console.log(e));
                    return send({ content: `✅ Ticket created: ${channel.toString()}`, components: [
                        { type: 1, components: [
                            { type: 2, style: 5, url: msg.url, label: "Go to ticket" }
                        ] }
                    ] })
                };
    
                case `${this.prefix}:close`: return send({ ephemeral: true, content: `🤔 Are you sure you want to close this ticket?`, components: [{ type: 1, components: [{ type: 2, custom_id: `${this.prefix}:close:confirm:${this.code(channel.topic?.split?.("ID: ")?.[1])}`, label: "Yes close the ticket", style: 4, emoji: { id: "807031399563264030" } }] }] })
            };
            if (customId.startsWith(`${this.prefix}:close:confirm`)) {
                let user = this.options.client.users.resolve(customId.split("close:confirm:")[1]) ?? await this.options.client.users.fetch(customId.split("close:confirm:")[1]).catch(() => null);
                if (!user) return send({ content: `❌ I was unable to fetch the user that opened the ticket.`, ephemeral: true })
                let messages = await this.fetchMessages(channel, 5000);
                if (!messages || !messages.length) return send({ ephemeral: true, content: `❌ I was unable to close the ticket, I couldn't fetch the messages in this channel.` })
                let closed = await channel.delete(`${member.user.tag} (${member.id}) closed the ticket.`).catch(() => null);
                if (!closed) return send({ ephemeral: true, content: `${emojis.x} I was unable to delete the channel & close the ticket.` })
                return this.closeTicket({ channel, guild, user, member, messages });
            }
        };
    };

    async starterMessage(channelId, options) {
        let channel = this.options.client.channels.resolve(channelId);
        if (!channel) return Promise.reject(`No channel found for: ${channelId}`);
        if (!channel.isText()) return Promise.reject(`The channel ID provided isn't a text-based-channel`);
        if (!channel.permissionsFor?.(this.options.client.user.id)?.has?.([ "VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS", "ATTACH_FILES", "READ_MESSAGE_HISTORY" ])) return Promise.reject(`I'm missing permissions in ${channel.name} (${channelId})`);
        return channel.send({
            content: options?.content,
            files: options?.attachments,
            embeds: options?.embeds,
            components: options?.components || [ { type: 1, components: [ this.button() ] } ]
        })
        .then(() => console.log(`Sent the starter message in ${channel.name} (${channel.id})`))
    };

    button(options = { style: 3, label: "Create Ticket", emoji: { name: "📩" } }) {
        return { type: 2, custom_id: options?.id || this.prefix, style: options.style || 3, label: options.label, emoji: options.emoji };
    };

    code(id, type = "d") {
        try {
            switch (type) {
                case "e": return encrypt(this.options.encryptToken, id);
                case "d": return decrypt(this.options.encryptToken, id);
            }
        } catch { 
            return id; 
        }
    };
};