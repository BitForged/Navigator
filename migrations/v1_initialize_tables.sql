# All directives below should "fail safely", just in case the user is upgrading from an installation that did not include
#   migrations. This is not necessarily problematic. However, all future migrations should ideally fail if the database
#   is in an unexpected state.
create table if not exists image_categories
(
    id       int auto_increment
        primary key,
    name64   varchar(255) not null,
    owner_id varchar(64)  not null
);

create table if not exists images
(
    id           varchar(64) charset latin1           not null
        primary key,
    image_data   longblob                             null,
    preview_data longblob                             null,
    message_id   varchar(64) charset latin1           null,
    owner_id     varchar(64) charset latin1           not null,
    created_at   datetime default current_timestamp() not null,
    category_id  int                                  null,
    constraint images_image_categories_id_fk
        foreign key (category_id) references image_categories (id)
            on delete set null
);

create table if not exists migrations
(
    migration_id        int                                  not null,
    migration_timestamp datetime default current_timestamp() null,
    constraint migrations_unique
        unique (migration_id)
);

create table if not exists models
(
    id            int auto_increment
        primary key,
    model_name    varchar(255) charset latin1 not null,
    friendly_name varchar(255) charset latin1 null,
    is_restricted tinyint(1) default 0        not null
);

