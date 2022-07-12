const { Collection, WebhookClient, MessageEmbed } = require("discord.js"),
    { encrypt, decrypt } = require("aes256"),
    { generate } = require("shortid"),
    { Interactions: { button, modal } } = require("@elara-services/packages"),
      Webhook = require("discord-hook"),
      de = {
        user: "<:Members:860931214232125450>",
        channel: "<:Channel:841654412509839390>",
        transcript: "<:Log:792290922749624320>"
      }

module.exports = class Tickets {
    constructor(options = {}) {
        if (typeof options !== "object") throw new Error(`You didn't provide any data in the constructor, fill it out!`);
        if (!("client" in options) || !("prefix" in options) || !("encryptToken" in options)) throw new Error(`You forgot to fill out either 'client', 'prefix' or 'encryptToken'`)
        this.options = options;
    };
    get prefix() { return `system:ticket:${this.options.prefix}`; };

    /** @private */
    get webhookOptions() {
        return {
            id: this.options.webhook?.id || this.options.webhookId,
            token: this.options.webhook?.token || this.options.webhookToken,
            username: this.options.webhook?.username || this.options.webhookUsername || "Tickets",
            avatar: this.options.webhook?.avatar || this.options.webhookAvatar || "https://cdn.discordapp.com/emojis/818757771310792704.png?v=1"
        }
    }
    webhook() {
        const { id, token, username, avatar } = this.webhookOptions;
        return new Webhook(`https://discord.com/api/webhooks/${id}/${token}`, { username, avatar_url: avatar });
    };

    /**
     * @param {import("discord.js").Interaction} int 
     */
    async run(int) {
        if (int?.isButton?.() || int?.isModalSubmit()) {
            let { guild, channel, member, customId } = int,
                category = guild?.channels?.resolve?.(this.options.ticketCategory || channel?.parentId);

            if (!guild || !guild.available || !channel || !member || !category) return;

            /**
             * @param {import("discord.js").InteractionDeferReplyOptions|import("discord.js").InteractionReplyOptions} options 
             * @param {boolean} edit 
             * @param {boolean} defer 
             */
            const send = async (options = {}, defer = false) => {
                if (defer) return int.deferReply(options).catch(e => this._debug(e));
                if (int.replied || int.deferred) return int.editReply(options).catch(e => this._debug(e));
                return int.reply(options).catch(e => this._debug(e));
            };
            switch (customId) {
                case this.prefix: {
                    if (this.options.modal?.enabled) {
                        return int.showModal(this.modal({
                            title: this.options.modal.title,
                            components: this.options.modal.questions?.length >= 1 ?
                                this.options.modal.questions.slice(0, 5).map(c => ({ type: 1, components: [{ min_length: c.min_length || 10, max_length: c.max_length || 4000, type: 4, style: c.style || 2, label: c.label, value: c.value, placeholder: c.placeholder, required: c.required, custom_id: c.label || `random_${Math.floor(Math.random() * 10000)}` }] })) :
                                []
                        })).catch(e => this._debug(e));
                    }
                    return this.handleCreate({ guild, member, category, send })
                };

                case `${this.prefix}:close`: {
                    if (this.options.support?.canOnlyCloseTickets && !member.permissions.has("MANAGE_GUILD")) {
                        let [ support, staffOnly ] = [ 
                            this.getSupportIds(), 
                            () => send({ 
                                ephemeral: true, 
                                embeds: [ { author: { name: `Only support staff can close tickets`, iconURL: "https://cdn.discordapp.com/emojis/781955502035697745.gif" }, color: 0xFF0000 } ] 
                            }) 
                        ];
                        if (!support.users?.includes?.(member.id)) return staffOnly();
                        if (support.roles?.length && !support.roles.some(c => member.roles.cache.has(c))) return staffOnly()
                    }
                    return send({ ephemeral: true, content: `🤔 Are you sure you want to close this ticket?`, components: [{ type: 1, components: [{ type: 2, custom_id: `${this.prefix}:close:confirm:${this.code(channel.topic?.split?.("ID: ")?.[1])}`, label: "Yes close the ticket", style: 4, emoji: { id: "807031399563264030" } }] }] })
                }

                case `${this.prefix}:modal_submit`: {
                    let [embed, fields, split] = [new MessageEmbed().setColor("ORANGE"), [], false];
                    for (const c of int.fields.components) {
                        for (const cc of c.components) {
                            if (cc.value && cc.customId) {
                                fields.push({ name: cc.customId, value: cc.value });
                                if (cc.value.length <= 1024) embed.addField(cc.customId, cc.value);
                                else split = true
                            }
                        }
                    }
                    if (embed.length >= 6000 || split) {
                        return this.handleCreate({ guild, member, category, send, embeds: fields.map((v, i) => ({
                            title: `Form Response: ${v.name}`,
                            color: embed.color,
                            description: v.value,
                            author: i === 0 ? { name: member.user.username, iconURL: member.user.displayAvatarURL({ dynamic: true }) } : undefined,
                            timestamp: fields.length - 1 === i ? new Date() : undefined,
                            footer: fields.length - 1 === i ? { text: `ID: ${member.id}` } : undefined
                        })) })
                    };
                    
                    return this.handleCreate({ guild, member, category, send, embeds: [
                        embed
                            .setTitle(`Form Responses`)
                            .setTimestamp()
                            .setAuthor({ name: member.user.username, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
                            .setFooter({ text: `ID: ${member.id}` })
                    ]})
                }
            };
            if (customId.startsWith(`${this.prefix}:close:confirm`)) {
                let user = this.options.client.users.resolve(customId.split("close:confirm:")[1]) ?? await this.options.client.users.fetch(customId.split("close:confirm:")[1]).catch(() => null);
                if (!user) return send({ content: `❌ I was unable to fetch the user that opened the ticket.`, ephemeral: true })
                let messages = await this.fetchMessages(channel, 5000);
                if (!messages || !messages.length) return send({ ephemeral: true, content: `❌ I was unable to close the ticket, I couldn't fetch the messages in this channel.` })
                let closed = await channel.delete(`${member.user.tag} (${member.id}) closed the ticket.`).catch(e => this._debug(e));
                if (!closed) return send({ ephemeral: true, content: `${emojis.x} I was unable to delete the channel & close the ticket.` })
                return this.closeTicket({ channel, guild, user, member, messages });
            }
        };
    };

    /** @private */
    async handleCreate({ guild, member, category, send, embeds = [] } = {}) {
        let [support, supportUsers, supportIds] = [[], [], this.getSupportIds()];
        if (supportIds.roles.length) for (const sup of supportIds.roles) {
            let role = guild.roles.resolve(sup);
            if (role) support.push(sup);
        };

        if (supportIds.users.length) for (const uId of supportIds.users) {
            let member = guild.members.resolve(uId) || await guild.members.fetch(uId).catch((e) => {
                if (e?.stack?.includes?.("Unknown Member")) this.options.support.users = this.options.support.users.filter(c => c !== uId);
                return this._debug(e);
            });
            if (member) supportUsers.push(uId);
        }
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
                            {
                                embeds: [
                                    {
                                        author: { name: guild.name, icon_url: guild.iconURL({ dynamic: true }) },
                                        title: "INFO",
                                        description: `❌ You can't open this ticket due to you not being banned in the main server!`,
                                        color: 0xFF0000,
                                        timestamp: new Date()
                                    }
                                ]
                            }
                    )
                }
            }
        }
        let [permissions, allow] = [
            [],
            ["ADD_REACTIONS", "ATTACH_FILES", "CREATE_INSTANT_INVITE", "EMBED_LINKS", "READ_MESSAGE_HISTORY", "VIEW_CHANNEL", "USE_EXTERNAL_EMOJIS", "SEND_MESSAGES"]
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
        }).catch(e => this._debug(e));
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
        }).catch(e => this._debug(e));
        if (!msg) return null;
        if (embeds?.length <= 10) for await (const embed of embeds) await channel.send({ embeds: [ embed ] }).catch(e => this._debug(e));
        if (this.webhookOptions.id && this.webhookOptions.token) this.webhook()
            .embed({
                author: { name: guild.name, icon_url: guild.iconURL({ dynamic: true }) },
                title: "Ticket: Opened",
                description: `${de.user} User: ${member.user.toString()} \`@${member.user.tag}\` (${member.id})\n${de.channel} Channel: \`#${channel.name}\` (${channel.id})`,
                color: 0xFF000,
                timestamp: new Date(),
                footer: { text: `Ticket ID: ${channel.name.split("-")[1]}` },
            }).send().catch(e => this._debug(e));
        return send({
            embeds: [
                {
                    author: { name: `Ticket Created!`, icon_url: `https://cdn.discordapp.com/emojis/476629550797684736.gif` },
                    description: channel.toString(),
                    color: 0xFF000
                }
            ],
            components: [ { type: 1, components: [ button({ title: "Go to ticket", url: msg.url }) ] } ]
        })
    }

    button(options = { style: 3, label: "Create Ticket", emoji: { name: "📩" } }) {
        return button({
            id: options?.id || this.prefix,
            style: options.style || 3,
            title: options.label,
            emoji: options.emoji
        });
    };

    /**
     * @param {object} options 
     * @param {string} [options.title] The title of the modal submit form 
     * @param {import("@elara-services/packages").Modal['components']} [options.components]
     */
    modal(options = { title: "", components: [] }) {
        return modal({
            id: `${this.prefix}:modal_submit`,
            title: options?.title || "Create Ticket",
            components: options?.components?.length >= 1 ? options.components : [
                {
                    type: 1, components: [
                        { type: 4, min_length: 10, max_length: 4000, custom_id: "message", label: "Content", style: 2, placeholder: "What's the ticket about?", required: true }
                    ]
                }
            ]
        })
    }

    async starterMessage(channelId, options) {
        let channel = this.options.client.channels.resolve(channelId);
        if (!channel) return Promise.reject(`No channel found for: ${channelId}`);
        if (!channel.isText()) return Promise.reject(`The channel ID provided isn't a text-based-channel`);
        if (!channel.permissionsFor?.(this.options.client.user.id)?.has?.(["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS", "ATTACH_FILES", "READ_MESSAGE_HISTORY"])) return Promise.reject(`I'm missing permissions in ${channel.name} (${channelId})`);
        return channel.send({
            content: options?.content,
            files: options?.attachments,
            embeds: options?.embeds,
            components: options?.components || [{ type: 1, components: [this.button()] }]
        })
            .then(() => console.log(`Sent the starter message in ${channel.name} (${channel.id})`))
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

    async fetchMessages(channel, limit = 50, before, after, around) {
        if (limit && limit > 100) {
            let logs = [];
            const get = async (_before, _after) => {
                const messages = [...(await channel.messages.fetch({ limit: 100, before: _before || undefined, after: _after || undefined }).catch(() => new Collection())).values()];
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
        return [...(await channel.messages.fetch({ limit, before, after, around }).catch(() => new Collection())).values()];
    };

    /**
     * @param {import("discord.js").TextBasedChannel} channel 
     * @param {import("discord.js").Message[]} messages 
     * @param {string} ticketID 
     * @param {string} type 
     * @returns {string}
     */
    displayMessages(channel, messages = [], ticketID, type) {
        let users = [];
        for (const i of messages.values()) {
            let f = users.find(c => c.user.id === i.author.id);
            if (f) f.count++; else users.push({ user: i.author, count: 1 });
        };
        return [`<discord-messages>`, `<discord-message author="${type} Ticket: ${ticketID}" bot="true" verified avatar="https://cdn.discordapp.com/emojis/847397714677334066.png?v=1" role-color="#1da1f2">Total Messages: ${users.map(c => c.count).reduce((a, b) => a + b, 0).toLocaleString()}<br>${users.map(c => `<discord-mention type="role" color="${channel.guild?.members?.resolve?.(c.user.id)?.displayColor ? channel.guild?.members?.resolve?.(c.user.id)?.displayHexColor : `#ffffff`}">${c.user.tag}</discord-mention> (${c.user.id})`).join("<br>")}</discord-message></discord-messages><discord-messages>`,
            ...messages.map(message => {
                let str = [
                    `<discord-message${message.author.bot ? ` bot="true" ${message.author.flags?.has?.("VERIFIED_BOT") ? `verified="true"` : ""}` : ""} new_timestamp="${message.createdAt.toISOString()}" author="${message.author.username}" avatar=${message.author.displayAvatarURL({ dynamic: true, format: "png" })} role-color="${channel.guild?.members?.cache?.get(message.author.id)?.displayColor ? channel.guild?.members?.cache?.get(message.author.id)?.displayHexColor : `#ffffff`}">`
                ];
                if (message.content) {
                    let content = message.content;
                    if (message.mentions.users.size) for (const user of message.mentions.users.values()) content = content.replace(new RegExp(`<@!?${user.id}>`, "g"), `<discord-mention type="role" color="${message.guild?.members?.cache?.get?.(user?.id)?.displayHexColor ?? "#ffffff"}">${user.tag}</discord-mention>`);
                    if (message.mentions.channels.size) for (const channel of message.mentions.channels.values()) content = content.replace(new RegExp(channel.toString(), "g"), `<discord-mention type="channel">${channel.name}</discord-mention>`);
                    if (message.mentions.roles.size) for (const role of message.mentions.roles.values()) content = content.replace(new RegExp(role.toString(), "g"), `<discord-mention type="role" color="${role.hexColor}">${role.name}</discord-mention>`)
                    str.push(content)
                };
                if (message.embeds?.length) {
                    let arr = [ `<discord-embeds slot="embeds">` ];
                    for (const embed of message.embeds) {
                        let emb = [
                            `<discord-embed slot="embed" ${embed.thumbnail?.url ? `thumbnail="${embed.thumbnail.url}"` : ""} ${embed.image?.url ? `image="${embed.image.url}"` : ""} ${embed.author ? `${embed.author.name ? `author-name="${embed.author.name}"` : ""} ${embed.author.iconURL ? `author-image="${embed.author.iconURL}"` : ""} ${embed.author.url ? `author-url="${embed.author.url}"` : ""}` : ""} ${embed.title ? `embed-title="${embed.title}"` : ""}${embed.color ? `color="${embed.hexColor}"` : ""}>`
                        ];
                        if (embed.description) emb.push(`<discord-embed-description slot="description">${embed.description}</discord-embed-description>`);
                        if (embed.fields?.length) {
                            emb.push(`<discord-embed-fields slot="fields">`)
                            for (const field of embed.fields) emb.push(`<discord-embed-field field-title="${field.name}" ${field.inline ? `inline` : ""}>${field.value}</discord-embed-field>`)
                        }
                        arr.push(...emb, `</discord-embed>`)
                    }
                    str.push(...arr, "</discord-embeds>")
                }
                if (message.interaction?.user) str.push(`<discord-command slot="reply" command="${message.interaction.type === "APPLICATION_COMMAND" ? "/" : ""}${message.interaction.commandName}" profile="${message.interaction.user.id}" role-color="${channel.guild?.members?.resolve?.(message.interaction.user?.id)?.displayHexColor || "#fffff"}" author="${message.interaction.user.tag}" avatar="${message.interaction.user.displayAvatarURL({ dynamic: true })}"></discord-command>`)
                if (message.components?.length) {
                    let row = [
                        `<discord-attachments slot="components">`
                    ],
                        styles = {
                            "PRIMARY": "primary",
                            "SECONDARY": "secondary",
                            "SUCCESS": "success",
                            "DANGER": "destructive",
                            "LINK": "secondary"
                        }
                    for (const components of message.components) {
                        row.push(`<discord-action-row>`)
                        for (const c of components.components) {
                            if (c.type === "BUTTON") row.push(`<discord-button ${c.disabled ? `disabled=true` : ""} type="${styles[c.style]}" ${c.emoji?.name ? `emoji-name="${c.emoji.name}"` : ""} ${c.emoji?.id ? `emoji="https://cdn.discordapp.com/emojis/${c.emoji.id}.${c.emoji.animated ? "gif" : "png"}"` : ""} ${c.url ? `url="${c.url}"` : ""}>${c.label || ""}</discord-button>`)
                        }
                        row.push(`</discord-action-row>`)
                    }
                    if (row.length >= 2) str.push(...row, `</discord-attachments>`)
                }
                if (message.attachments.size) str.push(message.attachments.map((c) => `<a href="${c.proxyURL}">${c.name}</a>`).join("<br>"))
                str.push(`${message.content?.length ? `<br><br>` : "" }<code style="background-color: #36393e; color: white;">ID: ${message.id}</code>`)
                return [...str, `</discord-message>`].join(" ");
            }),
            "</discord-messages>"].join(" ");
    };

    async closeTicket({ member, messages, channel, guild, user } = {}) {
        const { id, token, username, avatar: avatarURL } = this.webhookOptions;
        if (!id || !token) return;
        let embeds = [
            {
                author: { name: guild.name, icon_url: guild.iconURL({ dynamic: true }) },
                title: "Ticket: Closed",
                description: `${de.user}User: ${user.toString()} \`@${user.tag}\` (${user.id})\n${de.user}Closed By: ${member.toString()} (${member.id})\n${de.channel}Channel: \`#${channel.name}\` (${channel.id})`,
                color: 0xFF0000,
                timestamp: new Date(),
                footer: { text: `Ticket ID: ${channel.name.split("-")[1]}` },
            }
        ];
        new WebhookClient({ id, token })
            .send({
                username, avatarURL,
                embeds,
                files: [{ name: "transcript.txt", attachment: Buffer.from(this.displayMessages(channel, messages.reverse(), channel.name.split("-")[1], this.options.prefix)) }]
            })
            .then(m => {
                let components = [{ type: 2, style: 5, label: "Transcript", emoji: { id: "792290922749624320" }, url: `https://my.elara.services/tickets?url=${Array.isArray(m.attachments) ? m.attachments?.[0]?.url : m.attachments instanceof Collection ? m.attachments?.first?.()?.url : "URL_NOT_FOUND" ?? "URL_NOT_FOUND"}` }];
                embeds[0].description += `\n${de.transcript} Transcript: [View here](${components[0].url})`
                this.webhook()
                    .embeds(embeds)
                    .button({ type: 1, components })
                    .edit(m.id)
                    .catch(e => this._debug(e));
                if (user) user.send({
                    embeds: [{
                        author: { name: guild.name, icon_url: guild.iconURL({ dynamic: true }) },
                        title: `Ticket: Closed`,
                        color: 0xFF0000,
                        timestamp: new Date(),
                        footer: { text: `Ticket ID: ${channel.name.split("-")[1]}` }
                    }],
                    components: [{ type: 1, components }]
                }).catch(e => this._debug(e));
            }).catch(e => this._debug(e));
    };
    /**
     * @typedef {Object} getSupportResponse
     * @property {string[]} [roles]
     * @property {string[]} [users]
     * 
     * 
     * @private
     * @returns {getSupportResponse}
     */
    getSupportIds() {
        return {
            roles: this.options.support?.roles || this.options.supportRoleIds || [],
            users: this.options.support?.users || this.options.supportUserIds || []
        }
    }

    /** @private */
    _debug(...args) {
        if (!this.options?.debug) return null;
        console.log(...args);
        return null;
    }

};